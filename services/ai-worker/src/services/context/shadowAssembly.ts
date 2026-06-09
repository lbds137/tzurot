/**
 * Shadow context assembly — burn-in instrumentation for the worker-side
 * context assembler. Supersedes the hydration-only shadow when the job
 * carries `rawAssemblyInputs`; remove alongside CONTEXT_SHADOW_HYDRATION.
 *
 * For every job whose payload includes the raw assembly envelope, the
 * assembler re-derives the core context surfaces (user identity, persona,
 * timezone, epoch-filtered merged history) from raw inputs + REAL DB reads,
 * and the result is diffed against the bot-assembled payload. Generation is
 * never affected: fire-and-forget, every failure swallowed into a debug log.
 *
 * Telemetry contract: one structured log line per job with PER-SURFACE match
 * booleans and an aggregate `allMatched`. Match rate over a burn-in window =
 * grep `ShadowAssembly` / count `allMatched:true` — the go/no-go gate for
 * the envelope cutover.
 *
 * Reading note: contextEpoch is diffed only INDIRECTLY (a differing epoch
 * fetches different history rows), so `allMatched: true` means "epoch
 * effects on history agree," not "the epochs themselves were compared."
 */

import {
  createLogger,
  type CrossChannelHistoryGroupEntry,
  type JobContext,
  type LoadedPersonality,
  type MentionedPersona,
  type ReferencedChannel,
  type ReferencedMessage,
  type ResolvedConfigOverrides,
} from '@tzurot/common-types';
import type { ContextAssembler, AssembledCore } from './ContextAssembler.js';

const logger = createLogger('ShadowAssembly');

interface ShadowAssemblyParams {
  jobId: string | number | undefined;
  jobContext: JobContext;
  personality: LoadedPersonality;
  configOverrides: ResolvedConfigOverrides | undefined;
  assembler: ContextAssembler;
  /** Job enqueue timestamp — anchors the reference time-fallback dedup window. */
  jobTimestampMs: number | undefined;
  /**
   * The job's `message` field (the bot-rewritten content) — the comparison
   * target for the worker-rewritten messageContent. Undefined when the job
   * carries a non-string message shape.
   */
  payloadMessage: string | undefined;
  /**
   * Trigger-message transcripts produced by the WORKER's own STT
   * (preprocessing results) — diffed against the envelope's bot-side
   * rawRoutingTranscript as an STT-divergence metric. Telemetry only:
   * divergence between the two independent STT runs is expected and
   * measured, never a match failure.
   */
  workerTranscriptions: string[] | undefined;
}

interface SurfaceMatches {
  userInternalId: boolean;
  activePersonaId: boolean;
  activePersonaName: boolean;
  userTimezone: boolean;
  historyIds: boolean;
  historyContent: boolean;
  historyPersonaIds: boolean;
  /** True when matched OR skipped (envelope carried no raw references to re-derive from). */
  referencedMessages: boolean;
  /**
   * True when matched OR skipped (non-string payload messages only).
   * Voice jobs compare like any other: rawMessageContent is Discord ground
   * truth (empty for voice), matching the payload's empty rewritten content.
   */
  messageContent: boolean;
  /** Set comparison over persona ids (payload omits the field when empty). */
  mentionedPersonas: boolean;
  /** Set comparison over channel ids (payload omits the field when empty). */
  referencedChannels: boolean;
  /**
   * Cross-channel groups: strict on presence (one side undefined while the
   * other carries groups = gate disagreement, likely config divergence) and
   * on group-key sets; tolerant on extra assembled messages within a group
   * (timing drift); environment NAMES are counted but excluded from the
   * match (the worker decorates from the envelope's cache map while the bot
   * live-fetches — name drift is an accepted divergence).
   */
  crossChannelHistory: boolean;
}

/** Stable key for a cross-channel group (thread id when present, else channel id). */
function crossChannelGroupKey(group: CrossChannelHistoryGroupEntry): string {
  return group.channelEnvironment.thread?.id ?? group.channelEnvironment.channel.id;
}

/**
 * Cross-channel comparison. Presence-strict, group-key-strict,
 * message-tolerant (same tolerance shape as diffHistory).
 */
function diffCrossChannel(
  payload: CrossChannelHistoryGroupEntry[] | undefined,
  assembled: CrossChannelHistoryGroupEntry[] | undefined
): {
  matched: boolean;
  payloadGroups: number;
  assembledGroups: number;
  presenceMismatch: boolean;
  groupKeyMismatches: number;
  missingMessages: number;
  contentMismatches: number;
  envNameMismatches: number;
} {
  const result = {
    matched: true,
    payloadGroups: payload?.length ?? 0,
    assembledGroups: assembled?.length ?? 0,
    presenceMismatch: false,
    groupKeyMismatches: 0,
    missingMessages: 0,
    contentMismatches: 0,
    envNameMismatches: 0,
  };

  if (payload === undefined || assembled === undefined) {
    // Both absent = the feature was off on both sides — agreement.
    result.presenceMismatch = (payload === undefined) !== (assembled === undefined);
    result.matched = !result.presenceMismatch;
    return result;
  }

  const assembledByKey = new Map(assembled.map(g => [crossChannelGroupKey(g), g]));
  for (const payloadGroup of payload) {
    const assembledGroup = assembledByKey.get(crossChannelGroupKey(payloadGroup));
    if (assembledGroup === undefined) {
      result.groupKeyMismatches++;
      continue;
    }
    if (
      assembledGroup.channelEnvironment.channel.name !==
      payloadGroup.channelEnvironment.channel.name
    ) {
      result.envNameMismatches++;
    }
    const groupDiff = diffGroupMessages(payloadGroup, assembledGroup);
    result.missingMessages += groupDiff.missing;
    result.contentMismatches += groupDiff.content;
  }
  // Worker-only groups are also key mismatches (symmetric strictness).
  const payloadKeys = new Set(payload.map(crossChannelGroupKey));
  for (const key of assembledByKey.keys()) {
    if (!payloadKeys.has(key)) {
      result.groupKeyMismatches++;
    }
  }

  result.matched =
    result.groupKeyMismatches === 0 &&
    result.missingMessages === 0 &&
    result.contentMismatches === 0;
  return result;
}

/** Per-group message comparison: id-keyed, missing flagged, extra tolerated. */
function diffGroupMessages(
  payloadGroup: CrossChannelHistoryGroupEntry,
  assembledGroup: CrossChannelHistoryGroupEntry
): { missing: number; content: number } {
  const assembledById = new Map(
    assembledGroup.messages.filter(m => m.id !== undefined && m.id.length > 0).map(m => [m.id, m])
  );
  let missing = 0;
  let content = 0;
  for (const msg of payloadGroup.messages) {
    if (msg.id === undefined || msg.id.length === 0) {
      continue;
    }
    const assembledMsg = assembledById.get(msg.id);
    if (assembledMsg === undefined) {
      missing++;
    } else if (assembledMsg.content !== msg.content) {
      content++;
    }
  }
  return { missing, content };
}

/** Compare two optional id-bearing lists as sets (payload-parity: undefined ≡ []). */
function idSetsMatch<T>(
  payload: T[] | undefined,
  assembled: T[] | undefined,
  idOf: (item: T) => string
): boolean {
  const payloadIds = new Set((payload ?? []).map(idOf));
  const assembledIds = new Set((assembled ?? []).map(idOf));
  if (payloadIds.size !== assembledIds.size) {
    return false;
  }
  for (const id of payloadIds) {
    if (!assembledIds.has(id)) {
      return false;
    }
  }
  return true;
}

/**
 * History comparison over the DB-id-bearing subset (mirrors the 2.5a shadow's
 * tolerance): rows the assembler sees that the payload predates are expected
 * timing drift; rows the payload has that assembly lacks are real divergence.
 * Content/personaId compare only on the id-intersection.
 *
 * Rows without a non-empty id (extended-context messages that never hit the
 * DB) are excluded from BOTH sides — there's no stable key to cross-reference
 * them on. Note for telemetry readers: `payloadCount`/`assembledCount` in the
 * summary are raw lengths, so they can disagree without any diff flag firing
 * when the two sides carry different numbers of id-less rows.
 */
function diffHistory(
  payload: JobContext['conversationHistory'],
  assembled: AssembledCore['history']
): {
  ids: boolean;
  content: boolean;
  personaIds: boolean;
  missingFromAssembled: number;
  extraInAssembled: number;
  contentMismatches: number;
  personaIdMismatches: number;
} {
  const payloadById = new Map(
    (payload ?? [])
      .filter((m): m is typeof m & { id: string } => m.id !== undefined && m.id.length > 0)
      .map(m => [m.id, m])
  );
  const assembledById = new Map(
    assembled.filter(m => m.id !== undefined && m.id.length > 0).map(m => [m.id, m])
  );

  let missingFromAssembled = 0;
  let contentMismatches = 0;
  let personaIdMismatches = 0;
  for (const [id, payloadMsg] of payloadById) {
    const assembledMsg = assembledById.get(id);
    if (assembledMsg === undefined) {
      missingFromAssembled++;
      continue;
    }
    if (assembledMsg.content !== payloadMsg.content) {
      contentMismatches++;
    }
    if ((assembledMsg.personaId ?? '') !== (payloadMsg.personaId ?? '')) {
      personaIdMismatches++;
    }
  }
  let extraInAssembled = 0;
  for (const id of assembledById.keys()) {
    if (!payloadById.has(id)) {
      extraInAssembled++;
    }
  }

  return {
    ids: missingFromAssembled === 0,
    content: contentMismatches === 0,
    personaIds: personaIdMismatches === 0,
    missingFromAssembled,
    extraInAssembled,
    contentMismatches,
    personaIdMismatches,
  };
}

/**
 * Reference comparison, keyed by referenceNumber (adopted from the wire on
 * both sides, so numbers align by construction). Compares content and the
 * stub/full decision per number. Skipped (matched, compared:false) when the
 * assembler produced nothing — the envelope carried no raw references
 * (weigh-in mode or a sender predating the field).
 *
 * Dedup disagreement (one side stubs, the other keeps full) surfaces as
 * dedupMismatches; a payload number absent from the assembled set should be
 * impossible by construction and counts as missingFromAssembled.
 */
function diffReferences(
  payload: ReferencedMessage[] | undefined,
  assembled: ReferencedMessage[] | undefined
): {
  matched: boolean;
  compared: boolean;
  payloadCount: number;
  assembledCount: number;
  missingFromAssembled: number;
  extraInAssembled: number;
  contentMismatches: number;
  dedupMismatches: number;
} {
  // Payload omits the field when extraction found nothing — normalize to [].
  const payloadRefs = payload ?? [];
  if (assembled === undefined) {
    return {
      matched: true,
      compared: false,
      payloadCount: payloadRefs.length,
      assembledCount: 0,
      missingFromAssembled: 0,
      extraInAssembled: 0,
      contentMismatches: 0,
      dedupMismatches: 0,
    };
  }

  const assembledByNumber = new Map(assembled.map(r => [r.referenceNumber, r]));
  const payloadNumbers = new Set(payloadRefs.map(r => r.referenceNumber));
  let missingFromAssembled = 0;
  let contentMismatches = 0;
  let dedupMismatches = 0;
  for (const payloadRef of payloadRefs) {
    const assembledRef = assembledByNumber.get(payloadRef.referenceNumber);
    if (assembledRef === undefined) {
      missingFromAssembled++;
      continue;
    }
    if (assembledRef.content !== payloadRef.content) {
      contentMismatches++;
    }
    if ((assembledRef.isDeduplicated ?? false) !== (payloadRef.isDeduplicated ?? false)) {
      dedupMismatches++;
    }
  }

  // Worker-produced reference numbers the payload lacks — true
  // set-difference, so the metric stays accurate even when counts match
  // but the number sets are disjoint.
  const extraInAssembled = assembled.filter(r => !payloadNumbers.has(r.referenceNumber)).length;

  return {
    matched:
      assembled.length === payloadRefs.length &&
      missingFromAssembled === 0 &&
      // Implied by the two checks above while numbers stay unique; explicit
      // so the set-identity invariant survives future edits.
      extraInAssembled === 0 &&
      contentMismatches === 0 &&
      dedupMismatches === 0,
    compared: true,
    payloadCount: payloadRefs.length,
    assembledCount: assembled.length,
    missingFromAssembled,
    extraInAssembled,
    contentMismatches,
    dedupMismatches,
  };
}

/**
 * Run the assembler against the job's raw envelope and diff the core
 * surfaces against the bot-assembled payload. Fire-and-forget: never throws.
 */
export async function shadowAssembleAndDiff(params: ShadowAssemblyParams): Promise<void> {
  try {
    const { jobContext, personality, configOverrides, assembler } = params;
    if (jobContext.rawAssemblyInputs === undefined) {
      return;
    }

    const assembled = await assembler.assembleCore(jobContext, personality, configOverrides, {
      referenceDedupNowMs: params.jobTimestampMs,
    });
    const historyDiff = diffHistory(jobContext.conversationHistory, assembled.history);
    const referenceDiff = diffReferences(
      jobContext.referencedMessages,
      assembled.referencedMessages
    );

    const contentCompared = params.payloadMessage !== undefined;
    const contentDiff = {
      compared: contentCompared,
      matched: contentCompared ? assembled.messageContent === params.payloadMessage : true,
      // Left undefined (not 0) when there was no payload string to measure.
      payloadLength: params.payloadMessage?.length,
      assembledLength: assembled.messageContent.length,
    };
    const crossChannelDiff = diffCrossChannel(
      jobContext.crossChannelHistory,
      assembled.crossChannelHistory
    );

    // STT divergence: bot-side routing transcript vs the worker's own
    // transcription of the same audio. Two independent runs — divergence is
    // EXPECTED and measured (the go/no-go input for a future single-STT
    // optimization), so this never participates in allMatched.
    //
    // Multi-attachment join: the bot's rawRoutingTranscript is a single
    // string while the worker carries one transcription per attachment;
    // `equal` can only be true on multi-attachment messages if both sides
    // use this same '\n\n' join. When the divergence data matures into the
    // single-STT decision, pick the join strategy on the producing side to
    // match (or compare per-attachment instead).
    const botTranscript = jobContext.rawAssemblyInputs?.rawRoutingTranscript;
    const workerTranscript =
      params.workerTranscriptions !== undefined && params.workerTranscriptions.length > 0
        ? params.workerTranscriptions.join('\n\n')
        : undefined;
    // Single guard for compared AND equal: `equal` is undefined whenever the
    // pair wasn't compared — an asymmetric run (one side missing) must not
    // read as "compared and diverged" in the burn-in data.
    const bothTranscriptsPresent = botTranscript !== undefined && workerTranscript !== undefined;
    const sttDivergence = {
      compared: bothTranscriptsPresent,
      equal: bothTranscriptsPresent ? botTranscript === workerTranscript : undefined,
      botLength: botTranscript?.length,
      workerLength: workerTranscript?.length,
    };

    const matches: SurfaceMatches = {
      userInternalId: assembled.userInternalId === jobContext.userInternalId,
      // Weigh-in: assembler nulls the output persona; the payload omits the
      // field (bot cleared it). Both read as "no persona" — normalize so the
      // by-design weigh-in null doesn't poison allMatched.
      activePersonaId: (assembled.activePersonaId ?? undefined) === jobContext.activePersonaId,
      // Payload omits the name when the resolver returned null preferredName.
      activePersonaName:
        (assembled.activePersonaName ?? undefined) === jobContext.activePersonaName,
      // Payload omits the field for UTC users.
      userTimezone: assembled.userTimezone === (jobContext.userTimezone ?? 'UTC'),
      historyIds: historyDiff.ids,
      historyContent: historyDiff.content,
      historyPersonaIds: historyDiff.personaIds,
      referencedMessages: referenceDiff.matched,
      messageContent: contentDiff.matched,
      mentionedPersonas: idSetsMatch(
        jobContext.mentionedPersonas,
        assembled.mentionedPersonas,
        (p: MentionedPersona) => p.personaId
      ),
      referencedChannels: idSetsMatch(
        jobContext.referencedChannels,
        assembled.referencedChannels,
        (c: ReferencedChannel) => c.channelId
      ),
      crossChannelHistory: crossChannelDiff.matched,
    };
    const allMatched = Object.values(matches).every(Boolean);

    const summary = {
      jobId: params.jobId,
      // Shape hint: lets a DIVERGED line be attributed to its trigger without
      // manual log cross-referencing (a safe Discord ID, not message content).
      triggerMessageId: jobContext.triggerMessageId,
      allMatched,
      matches,
      historyDiff: {
        payloadCount: jobContext.conversationHistory?.length ?? 0,
        assembledCount: assembled.history.length,
        missingFromAssembled: historyDiff.missingFromAssembled,
        extraInAssembled: historyDiff.extraInAssembled,
        contentMismatches: historyDiff.contentMismatches,
        personaIdMismatches: historyDiff.personaIdMismatches,
      },
      referenceDiff,
      contentDiff,
      crossChannelDiff,
      sttDivergence,
    };

    if (allMatched) {
      logger.info(summary, 'ShadowAssembly matched bot-assembled context');
    } else {
      logger.warn(summary, 'ShadowAssembly DIVERGED from bot-assembled context');
    }
  } catch (error) {
    // Shadow instrumentation must never surface as a pipeline failure.
    logger.debug({ err: error, jobId: params.jobId }, 'Shadow assembly failed (ignored)');
  }
}
