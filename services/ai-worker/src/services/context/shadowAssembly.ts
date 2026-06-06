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
 */

import {
  createLogger,
  type JobContext,
  type LoadedPersonality,
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

    const matches: SurfaceMatches = {
      userInternalId: assembled.userInternalId === jobContext.userInternalId,
      activePersonaId: assembled.activePersonaId === jobContext.activePersonaId,
      // Payload omits the name when the resolver returned null preferredName.
      activePersonaName:
        (assembled.activePersonaName ?? undefined) === jobContext.activePersonaName,
      // Payload omits the field for UTC users.
      userTimezone: assembled.userTimezone === (jobContext.userTimezone ?? 'UTC'),
      historyIds: historyDiff.ids,
      historyContent: historyDiff.content,
      historyPersonaIds: historyDiff.personaIds,
      referencedMessages: referenceDiff.matched,
    };
    const allMatched = Object.values(matches).every(Boolean);

    const summary = {
      jobId: params.jobId,
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
