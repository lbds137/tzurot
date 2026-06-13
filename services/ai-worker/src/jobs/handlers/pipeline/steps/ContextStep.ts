/**
 * Context Step
 *
 * Prepares conversation context: history conversion, participant extraction,
 * and oldest timestamp calculation for LTM deduplication.
 */

import { createLogger, type MessageRole } from '@tzurot/common-types';
import {
  extractParticipants,
  convertConversationHistory,
} from '../../../utils/conversationUtils.js';
import type { ContextDataSource } from '../../../../services/context/types.js';
import {
  isShadowHydrationEnabled,
  shadowHydrateAndDiff,
} from '../../../../services/context/shadowHydration.js';
import { isAssemblyPromoteEnabled } from '../../../../services/context/contextFlags.js';
import { shadowAssembleAndDiff } from '../../../../services/context/shadowAssembly.js';
import type { ContextAssembler } from '../../../../services/context/ContextAssembler.js';
import type { IPipelineStep, GenerationContext, Participant, PreparedContext } from '../types.js';

const logger = createLogger('ContextStep');

/**
 * The shared history shape both the legacy payload (`ApiConversationMessage`)
 * and the worker-assembled history (`ConversationMessage`, after createdAt
 * normalization) satisfy, and which `convertConversationHistory` /
 * `extractParticipants` / `rawConversationHistory` all accept.
 */
type PromptHistorySource = {
  role: MessageRole;
  content: string;
  createdAt?: string;
  personaId?: string;
  personaName?: string;
}[];

/**
 * Extract timestamp from various formats (ISO string, Date object, or undefined)
 * Handles data from both DB history (string after JSON serialization) and
 * any unexpected Date objects that might bypass serialization.
 *
 * @param timestamp - ISO string, Date object, or undefined
 * @returns Unix timestamp in milliseconds, or null if invalid/missing
 */
function extractTimestamp(timestamp: string | Date | undefined | null): number | null {
  if (timestamp === undefined || timestamp === null) {
    return null;
  }

  // Handle Date objects directly (defensive - should be strings after BullMQ serialization)
  if (timestamp instanceof Date) {
    const time = timestamp.getTime();
    return Number.isNaN(time) ? null : time;
  }

  // Handle string timestamps (expected case - ISO format from toISOString())
  if (typeof timestamp === 'string' && timestamp.length > 0) {
    const time = new Date(timestamp).getTime();
    return Number.isNaN(time) ? null : time;
  }

  return null;
}

export class ContextStep implements IPipelineStep {
  readonly name = 'ContextPreparation';

  /**
   * @param contextDataSource - When provided AND `CONTEXT_SHADOW_HYDRATION=true`,
   * each job's DB-derived context is re-hydrated worker-side and diffed
   * against the bot-client payload (fire-and-forget, log-only). Burn-in
   * instrumentation for the context-assembly relocation; the payload
   * remains the source of truth for generation. Remove alongside the flag.
   */
  constructor(
    private readonly contextDataSource?: ContextDataSource,
    private readonly contextAssembler?: ContextAssembler
  ) {}

  /**
   * Resolved once per step instance (pipeline is built at startup) — the
   * flag only changes via a redeploy, so a per-job process.env read buys
   * nothing.
   */
  private readonly shadowEnabled = isShadowHydrationEnabled();

  /**
   * Resolved once per step instance (same rationale as {@link shadowEnabled}).
   * When true, the prompt context is built from the ContextAssembler instead
   * of the bot's legacy payload. Effective only when the job also carries
   * `rawAssemblyInputs` and an assembler is wired.
   */
  private readonly promoteEnabled = isAssemblyPromoteEnabled();

  /**
   * Route to the right shadow instrumentation. Raw envelope present + an
   * assembler wired → the FULL assembly shadow (real-DB hydration +
   * user/persona re-derivation + shared merge); otherwise the legacy
   * hydration-only shadow. Both intentionally not awaited — fire-and-forget
   * per the constructor JSDoc.
   */
  private dispatchShadow(
    job: Pick<GenerationContext['job'], 'id' | 'timestamp' | 'data'>,
    jobContext: GenerationContext['job']['data']['context'],
    personality: GenerationContext['job']['data']['personality'],
    configOverrides: GenerationContext['configOverrides'],
    preprocessing: GenerationContext['preprocessing']
  ): void {
    if (jobContext.rawAssemblyInputs !== undefined && this.contextAssembler !== undefined) {
      void shadowAssembleAndDiff({
        jobId: job.id,
        jobContext,
        personality,
        configOverrides,
        assembler: this.contextAssembler,
        // Enqueue time stands in for the bot's crawl-time wall clock in the
        // reference time-fallback dedup window.
        jobTimestampMs: job.timestamp,
        // The bot-rewritten content the worker's rewrite is diffed against.
        payloadMessage: typeof job.data.message === 'string' ? job.data.message : undefined,
        // Trigger transcripts from the worker's own STT (DependencyStep runs
        // before this step) — the bot-vs-worker STT divergence metric input.
        workerTranscriptions: preprocessing?.transcriptions,
      });
      return;
    }
    if (this.contextDataSource !== undefined) {
      void shadowHydrateAndDiff({
        jobId: job.id,
        jobContext,
        personalityId: personality.id,
        configOverrides,
        dataSource: this.contextDataSource,
      });
    }
  }

  async process(context: GenerationContext): Promise<GenerationContext> {
    const { job, config } = context;
    const { personality, context: jobContext } = job.data;

    if (!config) {
      throw new Error('[ContextStep] ConfigStep must run before ContextStep');
    }

    const promoted = this.resolvePromoted(jobContext);

    // The shadow validates the assembler against the legacy payload; once we
    // promote, the assembler IS the prompt, so the shadow is redundant. Run it
    // only when not promoting (also avoids racing the jobContext mutation).
    if (this.shadowEnabled && !promoted) {
      this.dispatchShadow(
        job,
        jobContext,
        personality,
        context.configOverrides,
        context.preprocessing
      );
    }

    const historyEntries = await this.sourceHistory(context, promoted);

    // Calculate oldest timestamp from conversation history AND referenced messages
    // (for LTM deduplication - prevents verbatim repetition when replying to AI messages)
    let oldestHistoryTimestamp: number | undefined;
    const allTimestamps: number[] = [];

    // Timestamps from conversation history
    // Note: createdAt may be ISO string (after BullMQ serialization) or Date object
    if (historyEntries.length > 0) {
      const historyTimestamps = historyEntries
        .map(msg => extractTimestamp(msg.createdAt as string | Date | undefined))
        .filter((t): t is number => t !== null);
      allTimestamps.push(...historyTimestamps);

      // Log diagnostic if we found fewer timestamps than messages
      if (historyTimestamps.length < historyEntries.length) {
        logger.warn(
          {
            jobId: job.id,
            historyLength: historyEntries.length,
            validTimestamps: historyTimestamps.length,
            missingTimestamps: historyEntries.length - historyTimestamps.length,
          },
          'Some conversation history messages missing valid createdAt timestamps'
        );
      }
    }

    // Timestamps from referenced messages (replies, message links)
    // These should also be excluded from LTM to prevent the AI from echoing
    // the content of messages being replied to
    if (jobContext.referencedMessages && jobContext.referencedMessages.length > 0) {
      const refTimestamps = jobContext.referencedMessages
        .map(ref => extractTimestamp(ref.timestamp as string | Date | undefined))
        .filter((t): t is number => t !== null);
      allTimestamps.push(...refTimestamps);
    }

    // Timestamps from cross-channel history (also excluded from LTM deduplication)
    if (jobContext.crossChannelHistory && jobContext.crossChannelHistory.length > 0) {
      for (const group of jobContext.crossChannelHistory) {
        const crossTimestamps = group.messages
          .map(msg => extractTimestamp(msg.createdAt))
          .filter((t): t is number => t !== null);
        allTimestamps.push(...crossTimestamps);
      }
    }

    if (allTimestamps.length > 0) {
      // Use reduce() instead of spread to avoid potential stack overflow with large arrays
      oldestHistoryTimestamp = allTimestamps.reduce((min, ts) => Math.min(min, ts), Infinity);
      logger.debug(
        { jobId: job.id, oldestTimestamp: new Date(oldestHistoryTimestamp).toISOString() },
        'Oldest timestamp (includes referenced and cross-channel messages)'
      );
    }

    // Extract unique participants BEFORE converting to BaseMessage
    const participants = extractParticipants(
      historyEntries,
      jobContext.activePersonaId,
      jobContext.activePersonaName
    );

    // Add mentioned personas to participants (if not already present)
    const allParticipants = this.mergeParticipants(participants, jobContext.mentionedPersonas);

    // Convert conversation history to BaseMessage format
    const conversationHistory = convertConversationHistory(historyEntries, personality.name);

    // Pass cross-channel history through to pipeline (structurally compatible)
    const crossChannelHistory = jobContext.crossChannelHistory;

    const preparedContext: PreparedContext = {
      conversationHistory,
      rawConversationHistory: historyEntries,
      oldestHistoryTimestamp,
      participants: allParticipants,
      crossChannelHistory,
    };

    // Race-window telemetry: if the bot-client queried DB for history BEFORE
    // the previous assistant response finished persisting, the cross-turn
    // duplicate detector will compare against stale history and miss genuine
    // duplicates. Log the delta between job-creation time and the newest
    // assistant message's persisted timestamp. Negative/small deltas are the
    // signal we'd expect to see when a rapid user follow-up races the write.
    this.logRaceWindowTelemetry(job, historyEntries);

    logger.debug(
      {
        jobId: job.id,
        historyLength: conversationHistory.length,
        participantCount: allParticipants.length,
      },
      'Context prepared'
    );

    return {
      ...context,
      preparedContext,
    };
  }

  /**
   * Decide whether to build the prompt from the worker-side assembler. Two
   * ways in:
   *  - mustAssemble: a `kind: 'envelope'` job — the producer DROPPED the legacy
   *    fields, so there is nothing to fall back to. Assemble regardless of the
   *    promote flag, and fail loud if no assembler is wired.
   *  - canPromote: a TRANSITIONAL fat-envelope job (envelope present, kind still
   *    'legacy'/absent) — gated on CONTEXT_ASSEMBLY_PROMOTE so iii-b-1's
   *    reversibility holds for these.
   * `kind` is read with `?? 'legacy'`: ValidationStep discards its parsed copy,
   * so the schema default never materializes on the raw job.data.
   */
  private resolvePromoted(jobContext: GenerationContext['job']['data']['context']): boolean {
    // rawAssemblyInputs presence on the mustAssemble path is guaranteed by the
    // llmGenerationContextSchema superRefine (envelope ⇒ rawAssemblyInputs).
    // ValidationStep parses before ContextStep runs, so a kind:'envelope' job
    // without the inputs would already have failed the job — hence no guard
    // here (unlike canPromote, which checks it defensively for legacy jobs).
    const mustAssemble = (jobContext.kind ?? 'legacy') === 'envelope';
    if (mustAssemble && this.contextAssembler === undefined) {
      throw new Error(
        "[ContextStep] context.kind 'envelope' requires a wired ContextAssembler; " +
          'the producer dropped the legacy fields, so there is no fallback'
      );
    }
    const canPromote =
      this.promoteEnabled &&
      jobContext.rawAssemblyInputs !== undefined &&
      this.contextAssembler !== undefined;
    return mustAssemble || canPromote;
  }

  /**
   * Source the prompt's conversation history. In promoted mode the
   * worker-assembled context replaces the bot's legacy payload: `historyEntries`
   * comes from the assembler (createdAt normalized Date → ISO for the
   * string-typed consumers), and the surfaces the downstream
   * conversationContextBuilder reads straight from jobContext (refs / channels /
   * mentions / persona / timezone / cross-channel) are overwritten in place —
   * mutating the worker's local job.data copy is safe (precedent:
   * DownloadAttachmentsStep). The bot still ships these legacy fields, so the
   * promotion is reversible by flag; a later cleanup removes them and this
   * re-sourcing once the bot stops shipping them.
   */
  private async sourceHistory(
    context: GenerationContext,
    promoted: boolean
  ): Promise<PromptHistorySource> {
    const { job } = context;
    const jobContext = job.data.context;
    const assembler = this.contextAssembler;
    if (!promoted || assembler === undefined) {
      // The `assembler === undefined` arm is unreachable when promoted (the
      // caller's gate already required it) — it just narrows the type here.
      return jobContext.conversationHistory ?? [];
    }

    const assembled = await assembler.assembleCore(
      jobContext,
      job.data.personality,
      context.configOverrides,
      { referenceDedupNowMs: job.timestamp }
    );
    jobContext.referencedMessages = assembled.referencedMessages;
    jobContext.referencedChannels = assembled.referencedChannels;
    jobContext.mentionedPersonas = assembled.mentionedPersonas;
    jobContext.activePersonaId = assembled.activePersonaId ?? undefined;
    jobContext.activePersonaName = assembled.activePersonaName ?? undefined;
    jobContext.userTimezone = assembled.userTimezone;
    jobContext.userInternalId = assembled.userInternalId;
    jobContext.crossChannelHistory = assembled.crossChannelHistory;
    // Guild surfaces adopt the assembled value only when the envelope carried
    // the raw source — an envelope from a sender predating the raw guild
    // fields must keep its payload copy (overwriting with the assembler's
    // undefined would silently clobber valid data, the forward-bug class).
    if (jobContext.rawAssemblyInputs?.rawParticipantGuildInfo !== undefined) {
      jobContext.participantGuildInfo = assembled.participantGuildInfo;
    }
    if (jobContext.rawAssemblyInputs?.rawActiveGuildMemberInfo !== undefined) {
      jobContext.activePersonaGuildInfo = assembled.activePersonaGuildInfo;
    }
    job.data.message = assembled.messageContent;

    // Permanent observability: which path drove this prompt. Counts + kind
    // only — NO content/PII (per the no-PII logging rule). Without this, the
    // promoted path is silent and "did the assembler run?" can only be answered
    // by archaeology through the prisma query log.
    logger.info(
      {
        jobId: job.id,
        kind: jobContext.kind ?? 'legacy',
        historyLength: assembled.history.length,
        referencedCount: assembled.referencedMessages?.length ?? 0,
        mentionedCount: assembled.mentionedPersonas?.length ?? 0,
        crossChannelGroups: assembled.crossChannelHistory?.length ?? 0,
      },
      'Context assembled via promoted path'
    );

    return assembled.history.map(m => ({
      ...m,
      // Normalize Date → ISO for the string-typed prompt consumers. The
      // non-Date branch preserves undefined/string as-is (coercing undefined to
      // the literal "undefined" would misparse downstream).
      createdAt:
        m.createdAt instanceof Date
          ? m.createdAt.toISOString()
          : (m.createdAt as string | undefined),
    }));
  }

  /**
   * Emit telemetry on the delta between job creation time and the newest
   * prior assistant response's persisted `createdAt` in the history snapshot.
   *
   * Two distinct scenarios we want to diagnose post-hoc:
   *
   * 1. **Barely-post-persistence**: `deltaMs < 500ms`. Job created just
   *    after persistence completed. Timing-suspicious; logged at `warn`
   *    so it's grep-able.
   *
   * 2. **Pre-persistence race (primary failure mode)**: the bot's prior
   *    response was NOT persisted before the history query ran, so it's
   *    absent from `history` entirely. `newestAssistantTimestamp` here
   *    reflects an OLDER message — typically minutes ago — and `deltaMs`
   *    is LARGE, not small. The `warn` threshold won't fire for this
   *    case. But the logged `newestAssistantTimestamp` itself is the
   *    signal: if a user reports a duplicate and we see the "most recent"
   *    assistant message in history is from many minutes ago even though
   *    the bot just responded, the race happened.
   *
   * For that reason this emits at `info` level in the non-race case too
   * — we want the data available for post-hoc correlation, not stuck
   * behind debug-level filtering.
   */
  private logRaceWindowTelemetry(
    job: { id?: string | number; timestamp?: number },
    history: { role: string; createdAt?: string | Date }[]
  ): void {
    if (history.length === 0) {
      return;
    }

    let newestAssistantTimestamp: number | null = null;
    for (const msg of history) {
      if (msg.role.toLowerCase() !== 'assistant') {
        continue;
      }
      const ts = extractTimestamp(msg.createdAt);
      if (ts !== null && (newestAssistantTimestamp === null || ts > newestAssistantTimestamp)) {
        newestAssistantTimestamp = ts;
      }
    }

    if (newestAssistantTimestamp === null) {
      return;
    }

    const jobTimestamp = job.timestamp;
    if (jobTimestamp === undefined) {
      return;
    }

    const deltaMs = jobTimestamp - newestAssistantTimestamp;
    // Distinguish three cases:
    //   deltaMs < 0    → clock skew (job timestamp before persisted timestamp);
    //                    shouldn't happen in practice (BullMQ + Postgres
    //                    colocated on Railway) but triage needs it labeled
    //                    separately if it ever does.
    //   0 ≤ deltaMs < 500 → race-suspect (job created shortly after persistence).
    //   deltaMs ≥ 500     → normal; emitted at info for post-hoc correlation
    //                        on the pre-persistence race (where the "newest"
    //                        assistant message would reflect a much older turn).
    const suggestsClockSkew = deltaMs < 0;
    const suggestsRace = !suggestsClockSkew && deltaMs < 500;

    if (suggestsClockSkew) {
      logger.warn(
        {
          jobId: job.id,
          jobTimestamp: new Date(jobTimestamp).toISOString(),
          newestAssistantTimestamp: new Date(newestAssistantTimestamp).toISOString(),
          deltaMs,
          suggestsClockSkew,
        },
        `Clock-skew signal: job timestamp is ${Math.abs(deltaMs)}ms BEFORE the ` +
          `newest assistant message's persisted timestamp. Not a race condition — a clock or ` +
          `data-source mismatch worth investigating.`
      );
    } else if (suggestsRace) {
      logger.warn(
        {
          jobId: job.id,
          jobTimestamp: new Date(jobTimestamp).toISOString(),
          newestAssistantTimestamp: new Date(newestAssistantTimestamp).toISOString(),
          deltaMs,
          suggestsRace,
        },
        `Race-window signal: job created ${deltaMs}ms after newest assistant message persisted. ` +
          `Cross-turn duplicate detector may miss prior response.`
      );
    } else {
      logger.info(
        {
          jobId: job.id,
          jobTimestamp: new Date(jobTimestamp).toISOString(),
          newestAssistantTimestamp: new Date(newestAssistantTimestamp).toISOString(),
          deltaMs,
          suggestsRace,
        },
        'Race-window telemetry'
      );
    }
  }

  /**
   * Merge mentioned personas into participant list
   */
  private mergeParticipants(
    participants: Participant[],
    mentionedPersonas?: { personaId: string; personaName: string }[]
  ): Participant[] {
    if (!mentionedPersonas || mentionedPersonas.length === 0) {
      return participants;
    }

    const existingIds = new Set(participants.map(p => p.personaId));
    const mentionedParticipants = mentionedPersonas
      .filter(mentioned => !existingIds.has(mentioned.personaId))
      .map(mentioned => ({
        personaId: mentioned.personaId,
        personaName: mentioned.personaName,
        isActive: false,
      }));

    if (mentionedParticipants.length > 0) {
      return [...participants, ...mentionedParticipants];
    }

    return participants;
  }
}
