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
}

interface SurfaceMatches {
  userInternalId: boolean;
  activePersonaId: boolean;
  activePersonaName: boolean;
  userTimezone: boolean;
  historyIds: boolean;
  historyContent: boolean;
  historyPersonaIds: boolean;
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
 * Run the assembler against the job's raw envelope and diff the core
 * surfaces against the bot-assembled payload. Fire-and-forget: never throws.
 */
export async function shadowAssembleAndDiff(params: ShadowAssemblyParams): Promise<void> {
  try {
    const { jobContext, personality, configOverrides, assembler } = params;
    if (jobContext.rawAssemblyInputs === undefined) {
      return;
    }

    const assembled = await assembler.assembleCore(jobContext, personality, configOverrides);
    const historyDiff = diffHistory(jobContext.conversationHistory, assembled.history);

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
