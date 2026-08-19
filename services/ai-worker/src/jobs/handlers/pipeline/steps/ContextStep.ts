/**
 * Context Step
 *
 * Prepares conversation context: history conversion, participant extraction,
 * and oldest timestamp calculation for LTM deduplication.
 */

import { type MessageRole } from '@tzurot/common-types/constants/message';
import { type AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import { type SttDispatch } from '@tzurot/common-types/types/sttProvider';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { getSystemSetting } from '@tzurot/common-types/services/SystemSettingsService';
import {
  extractParticipants,
  convertConversationHistory,
} from '../../../utils/conversationUtils.js';
import { extractCharacterParticipants } from '../../../utils/participantUtils.js';
import type { ContextDataSource } from '../../../../services/context/types.js';
import type {
  AssembledCore,
  ContextAssembler,
} from '../../../../services/context/ContextAssembler.js';
import { transcribeAudio } from '../../../../services/multimodal/AudioProcessor.js';
import type { IPipelineStep, GenerationContext, Participant, PreparedContext } from '../types.js';

const logger = createLogger('ContextStep');

/**
 * STT fallback for an extended-context voice transcript the assembler's DB-first
 * lookup misses (never-persisted ambient voice). `transcribeAudio` is itself
 * Redis-cache-first, so a still-cached transcript costs no STT call. Failures
 * (expired Discord CDN url, no provider) degrade to null — the message simply
 * keeps no transcript, same as before this feature. Defaults to the self-hosted
 * voice-engine dispatch when no BYOK STT was resolved (mirrors AttachmentProcessor).
 */
export async function reTranscribeExtendedContextVoice(
  attachment: AttachmentMetadata,
  sttDispatch: SttDispatch | undefined
): Promise<string | null> {
  try {
    const result = await transcribeAudio(attachment, sttDispatch ?? { provider: 'voice-engine' });
    return result.text.length > 0 ? result.text : null;
  } catch (err) {
    logger.warn(
      { err, originalUrl: attachment.originalUrl ?? attachment.url },
      'Extended-context voice re-transcription failed; keeping the message transcript-less'
    );
    return null;
  }
}

/**
 * Apply the assembler's output onto the worker's local job.data in place. This
 * is the propagation mechanism: the downstream conversationContextBuilder reads
 * these surfaces straight off jobContext, so the assembled values must land
 * there for the later pipeline step to see them (there is no shared return
 * channel between steps). Mutating the worker's local copy is safe — it's a
 * deserialized per-job object, not shared state (precedent: DownloadAttachmentsStep).
 *
 * Idempotent by construction: every write is a pure overwrite, and assembleCore
 * derives its output solely from rawAssemblyInputs + the job's scalar identity
 * fields (userId/channelId/serverId/isWeighIn) — NONE of the fields written
 * here. So re-running assemble+apply yields the same result regardless of a
 * prior application (verified against ContextAssembler's reads).
 */
function applyAssembledContext(job: GenerationContext['job'], assembled: AssembledCore): void {
  const jobContext = job.data.context;
  jobContext.referencedMessages = assembled.referencedMessages;
  jobContext.referencedChannels = assembled.referencedChannels;
  jobContext.mentionedPersonas = assembled.mentionedPersonas;
  jobContext.activePersonaId = assembled.activePersonaId ?? undefined;
  jobContext.activePersonaName = assembled.activePersonaName ?? undefined;
  jobContext.userTimezone = assembled.userTimezone;
  jobContext.userInternalId = assembled.userInternalId;
  jobContext.crossChannelHistory = assembled.crossChannelHistory;
  // Guild surfaces adopt the assembled value only when the envelope carried the
  // raw source — an envelope from a sender predating the raw guild fields must
  // keep its payload copy (overwriting with the assembler's undefined would
  // silently clobber valid data, the forward-bug class). The guard is removed
  // once every producer ships the raw forms (no legacy fallback to protect).
  if (jobContext.rawAssemblyInputs?.rawParticipantGuildInfo !== undefined) {
    jobContext.participantGuildInfo = assembled.participantGuildInfo;
  }
  if (jobContext.rawAssemblyInputs?.rawActiveGuildMemberInfo !== undefined) {
    jobContext.activePersonaGuildInfo = assembled.activePersonaGuildInfo;
  }
  // Unconditionally overwrites bot-client's raw message content (which may still
  // carry unresolved user mentions) with the worker's re-derivation. The entire
  // bot-client Prisma eviction rests on this running for every job — there is no
  // legacy fallback, and skipping it would ship the unrewritten content.
  job.data.message = assembled.messageContent;
}

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
  /**
   * Declared because the assembler's rows carry it and this path reads it:
   * `extractCharacterParticipants` keys the sibling roster on `personalityId`,
   * and a shape that omitted it would have made every row look sibling-less to
   * the compiler while carrying a real id at runtime.
   */
  personalityId?: string;
  personalityName?: string;
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

  constructor(
    private readonly contextAssembler?: ContextAssembler,
    private readonly dataSource?: ContextDataSource
  ) {}

  async process(context: GenerationContext): Promise<GenerationContext> {
    const { job, config } = context;
    const { personality, context: jobContext } = job.data;

    if (!config) {
      throw new Error('[ContextStep] ConfigStep must run before ContextStep');
    }

    const assembler = this.assertEnvelopeJob(jobContext);
    const historyEntries = await this.sourceHistory(context, assembler);

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
    const nonHistoryTimestamps: number[] = [];
    if (jobContext.referencedMessages && jobContext.referencedMessages.length > 0) {
      const refTimestamps = jobContext.referencedMessages
        .map(ref => extractTimestamp(ref.timestamp as string | Date | undefined))
        .filter((t): t is number => t !== null);
      nonHistoryTimestamps.push(...refTimestamps);
    }

    // Timestamps from cross-channel history (also excluded from LTM deduplication)
    if (jobContext.crossChannelHistory && jobContext.crossChannelHistory.length > 0) {
      for (const group of jobContext.crossChannelHistory) {
        const crossTimestamps = group.messages
          .map(msg => extractTimestamp(msg.createdAt))
          .filter((t): t is number => t !== null);
        nonHistoryTimestamps.push(...crossTimestamps);
      }
    }
    allTimestamps.push(...nonHistoryTimestamps);

    // Kept separate from oldestHistoryTimestamp: the STM/LTM cutoff treats
    // current-channel history EXACTLY (only what actually ships excludes LTM)
    // but stays pessimistic for refs + cross-channel (they lack per-message
    // shipped-id plumbing) — so the budget pre-pass needs this min on its own.
    const nonHistoryOldestTimestamp =
      nonHistoryTimestamps.length > 0
        ? nonHistoryTimestamps.reduce((min, ts) => Math.min(min, ts), Infinity)
        : undefined;

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

    const characterBlurbs = await this.fetchCharacterBlurbs(historyEntries, personality);

    const preparedContext: PreparedContext = {
      conversationHistory,
      rawConversationHistory: historyEntries,
      oldestHistoryTimestamp,
      nonHistoryOldestTimestamp,
      participants: allParticipants,
      crossChannelHistory,
      characterBlurbs,
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
   * Fetch the sibling characters' generated roster blurbs.
   *
   * HERE rather than at render time, and that placement is the load-bearing
   * part. `PromptBuilder` is a pure formatter with no Prisma, and the roster
   * renders TWICE per turn — once in `ContentBudgetManager`'s pre-pass
   * measurement and once in the shipped prompt. A fetch at render time would
   * run twice, and any drift between the two answers would corrupt the token
   * budget, which holds only while both passes see identical inputs.
   *
   * The roster is derived with `extractCharacterParticipants` over the SAME
   * array the prompt builder will read (`PreparedContext.rawConversationHistory`),
   * so the two agree by construction rather than by a duplicated membership
   * rule. Should they ever diverge anyway, the failure is a missing blurb —
   * name-only, the un-generated state — never a wrong one.
   *
   * Gated on `rosterBlurbEnabled` FIRST, the same live switch the generator
   * sweep reads: the flag is the feature's kill switch, so turning it off stops
   * rendering already-stored blurbs as well as stopping new spend. Off also
   * means no query at all. The data-source guard behind it is a wiring check
   * for callers that construct the step without one (unit tests, direct
   * dispatch); production always wires it — see `buildContextStep`.
   *
   * A fetch failure degrades to name-only rather than failing the turn. The
   * blurb is an enrichment; losing it costs a sentence of context, and the
   * roster (names + ids, which `from_id` binding depends on) is unaffected.
   */
  private async fetchCharacterBlurbs(
    history: PromptHistorySource,
    personality: { id?: string; name: string }
  ): Promise<Record<string, string> | undefined> {
    if (getSystemSetting('rosterBlurbEnabled') !== true || this.dataSource === undefined) {
      return undefined;
    }
    const ids = extractCharacterParticipants(history, personality.name, personality.id).map(
      character => character.personalityId
    );
    if (ids.length === 0) {
      return undefined;
    }
    try {
      const blurbs = await this.dataSource.getRosterBlurbsByIds(ids);
      return blurbs.size > 0 ? Object.fromEntries(blurbs) : undefined;
    } catch (err) {
      logger.warn(
        { err, rosterSize: ids.length },
        'Roster-blurb fetch failed; rendering name-only'
      );
      return undefined;
    }
  }

  /**
   * Every job is a `kind: 'envelope'` thin payload — worker-side assembly is
   * the only path. The schema now requires the discriminant, but this guard
   * reads RAW job.data (tests and direct dispatch can bypass ValidationStep),
   * so a missing or non-envelope kind still fails loud here rather than
   * silently mis-assembling.
   *
   * Returns the (now narrowed, non-undefined) assembler so the caller threads it
   * into {@link sourceHistory} explicitly — making the "assembler is wired" proof
   * a value dependency rather than an implicit call-order coupling.
   */
  private assertEnvelopeJob(
    jobContext: GenerationContext['job']['data']['context']
  ): ContextAssembler {
    // The cast deliberately defeats the narrowed literal type: the TYPE says
    // kind can only be 'envelope', but this reads unvalidated raw job.data.
    if ((jobContext.kind as string | undefined) !== 'envelope') {
      throw new Error(
        "[ContextStep] every job must carry context.kind 'envelope'; legacy job " +
          'shapes are no longer supported (producer must ship the raw envelope)'
      );
    }
    if (this.contextAssembler === undefined) {
      throw new Error("[ContextStep] context.kind 'envelope' requires a wired ContextAssembler");
    }
    return this.contextAssembler;
  }

  /**
   * Source the prompt's conversation history from the worker-side assembler:
   * `historyEntries` comes from `assembleCore` (createdAt normalized Date → ISO
   * for the string-typed consumers), and the assembled surfaces are applied
   * onto jobContext by {@link applyAssembledContext} so the downstream
   * conversationContextBuilder reads them. The `assembler` is the non-undefined
   * value returned by {@link assertEnvelopeJob}, threaded in by {@link process}.
   */
  private async sourceHistory(
    context: GenerationContext,
    assembler: ContextAssembler
  ): Promise<PromptHistorySource> {
    const { job } = context;
    const jobContext = job.data.context;

    const sttDispatch = context.auth?.sttDispatch;
    const assembled = await assembler.assembleCore(
      jobContext,
      job.data.personality,
      context.configOverrides,
      {
        referenceDedupNowMs: job.timestamp,
        reTranscribeVoiceViaStt: attachment =>
          reTranscribeExtendedContextVoice(attachment, sttDispatch),
      }
    );
    applyAssembledContext(job, assembled);

    // Permanent observability: counts + kind only — NO content/PII (per the
    // no-PII logging rule). Without this, the assembly is silent and "did the
    // assembler run?" can only be answered by archaeology through the prisma
    // query log.
    logger.info(
      {
        jobId: job.id,
        kind: jobContext.kind,
        historyLength: assembled.history.length,
        referencedCount: assembled.referencedMessages?.length ?? 0,
        mentionedCount: assembled.mentionedPersonas?.length ?? 0,
        crossChannelGroups: assembled.crossChannelHistory?.length ?? 0,
      },
      'Context assembled'
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
