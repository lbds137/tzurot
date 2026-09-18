/**
 * Recent-days digest sweep — the generation half of the design.
 *
 * One tick selects up to `MAX_GENERATIONS_PER_SWEEP` due (persona,
 * personality) pairs (the single selection query in
 * `recentDaysDigestSelection.ts`, shared with the `digest:candidates`
 * tooling command), materializes a row for every never-generated pair, then
 * generates sequentially — same one-try-around-the-whole-row shape as
 * `rosterBlurbSweep.ts`, and the same never-log-content discipline
 * (`00-critical.md` § Logging). The model round itself (window load, prompt
 * build, first pass + regeneration) lives in `recentDaysDigestGeneration.ts`;
 * this file owns selecting the due pairs and writing the outcome.
 */

import { AIProvider } from '@tzurot/common-types/constants/ai';
import {
  RECENT_DAYS_DIGEST,
  RECENT_DAYS_DIGEST_PROMPT_VERSION,
  type DigestFailureClass,
} from '@tzurot/common-types/constants/recentDaysDigest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  selectDigestCandidatePairs,
  type DigestCandidatePair,
} from '@tzurot/common-types/services/recentDaysDigestSelection';
import { getSystemSetting } from '@tzurot/common-types/services/SystemSettingsService';
import { contentDigest } from '@tzurot/common-types/utils/logContentPreview';
import { createLogger } from '@tzurot/common-types/utils/logger';
import {
  resolveSystemModelRoute,
  type SystemModelInvoker,
} from '../systemModel/systemModelCall.js';
import { makeRecentDaysDigestInvoker } from './makeRecentDaysDigestInvoker.js';
import {
  buildPairGenerationContext,
  loadWindowRows,
  runGeneration,
} from './recentDaysDigestGeneration.js';
import {
  materializePendingRows,
  storeDigestSuccess,
  recordDigestFailure,
  readDigestStatus,
} from './recentDaysDigestStore.js';

const logger = createLogger('RecentDaysDigestSweep');

/** Throttled to at most once per hour per process — mirrors the archive
 *  summarizer's route-misconfiguration log. */
const ROUTE_ERROR_LOG_INTERVAL_MS = 60 * 60_000;
let lastRouteErrorAt = 0;

export interface RecentDaysDigestSweepStats {
  selected: number;
  generated: number;
  failedBilled: number;
  dead: number;
  failedZeroSpend: number;
  guardMisses: number;
  skipped: null | 'disabled' | 'no_personalities' | 'route';
}

function emptyStats(): RecentDaysDigestSweepStats {
  return {
    selected: 0,
    generated: 0,
    failedBilled: 0,
    dead: 0,
    failedZeroSpend: 0,
    guardMisses: 0,
    skipped: null,
  };
}

/** A route that cannot disable reasoning must never bill a digest call. */
function logRouteError(provider: AIProvider): void {
  const now = Date.now();
  if (now - lastRouteErrorAt < ROUTE_ERROR_LOG_INTERVAL_MS) {
    return;
  }
  logger.error({ provider }, 'Recent-days digest route is not zai-coding — skipping this tick');
  lastRouteErrorAt = now;
}

interface FinishArgs {
  prisma: PrismaClient;
  id: string;
  pair: DigestCandidatePair;
  stats: RecentDaysDigestSweepStats;
}

/** Apply the guarded failure write and classify the outcome into stats. */
async function finishFailure(
  args: FinishArgs & {
    attemptedWatermark: Date;
    errorClass: DigestFailureClass;
    detail: string;
  }
): Promise<void> {
  const { prisma, id, pair, stats, attemptedWatermark, errorClass, detail } = args;
  const affected = await recordDigestFailure(prisma, {
    id,
    seenRequestedAt: pair.requestedAt,
    attemptedWatermark,
    promptVersion: RECENT_DAYS_DIGEST_PROMPT_VERSION,
    errorClass,
  });
  if (affected === 0) {
    stats.guardMisses += 1;
    logger.info(
      { personaId: pair.personaId, personalityId: pair.personalityId },
      'Recent-days digest failure write matched no row — a concurrent clear/delete or purge won'
    );
    return;
  }
  const { status, attempts } = await readDigestStatus(prisma, id);
  // The `quotation` detail is a verbatim n-gram of the character's own
  // conversation rows, so the log carries only its length and digest; the
  // literal stays in the validator result for the regeneration feedback and
  // the operator dry-run report, which prints to the operator terminal only.
  const logDetail =
    errorClass === 'quotation'
      ? `quoted ${detail.split(/\s+/).filter(Boolean).length}-word n-gram, digest ${contentDigest(detail)}`
      : detail;
  logger.warn(
    {
      personaId: pair.personaId,
      personalityId: pair.personalityId,
      cls: errorClass,
      detail: logDetail,
      attempts,
      status,
    },
    'Recent-days digest attempt rejected'
  );
  if (status === 'dead') {
    stats.dead += 1;
  } else {
    stats.failedBilled += 1;
  }
}

/** Apply the guarded success write. */
async function finishSuccess(
  args: FinishArgs & {
    text: string;
    model: string;
    sourceWatermark: Date;
    windowStart: Date;
    sourceRowCount: number;
    sourceRowIds: string[];
  }
): Promise<void> {
  const {
    prisma,
    id,
    pair,
    stats,
    text,
    model,
    sourceWatermark,
    windowStart,
    sourceRowCount,
    sourceRowIds,
  } = args;
  const affected = await storeDigestSuccess(prisma, {
    id,
    seenRequestedAt: pair.requestedAt,
    text,
    model,
    promptVersion: RECENT_DAYS_DIGEST_PROMPT_VERSION,
    sourceWatermark,
    windowStart,
    sourceRowCount,
    sourceRowIds,
    sourceEpoch: pair.epoch,
  });
  if (affected === 0) {
    stats.guardMisses += 1;
    logger.info(
      { personaId: pair.personaId, personalityId: pair.personalityId },
      'Recent-days digest success write matched no row — a concurrent clear/delete or purge won'
    );
    return;
  }
  stats.generated += 1;
}

interface ProcessOnePairArgs {
  prisma: PrismaClient;
  pair: DigestCandidatePair;
  id: string;
  invoke: SystemModelInvoker;
  stats: RecentDaysDigestSweepStats;
  now: Date;
}

/** One pair, start to finish: load its window, build the prompt, run the
 *  model round, and write the outcome. */
async function processOnePair(args: ProcessOnePairArgs): Promise<void> {
  const { prisma, pair, id, invoke, stats, now } = args;
  const rows = await loadWindowRows(prisma, pair, now);
  const { windowInput, promptInput, assistantContents } = buildPairGenerationContext(pair, rows);

  const outcome = await runGeneration({ prisma, pair, invoke, promptInput, assistantContents });

  if (outcome.kind === 'parse_failure') {
    await finishFailure({
      prisma,
      id,
      pair,
      stats,
      attemptedWatermark: windowInput.sourceWatermark,
      errorClass: 'parse_failure',
      detail: 'model response did not parse',
    });
    return;
  }
  if (outcome.kind === 'failed') {
    await finishFailure({
      prisma,
      id,
      pair,
      stats,
      attemptedWatermark: windowInput.sourceWatermark,
      errorClass: outcome.cls,
      detail: outcome.detail,
    });
    return;
  }

  await finishSuccess({
    prisma,
    id,
    pair,
    stats,
    text: outcome.text,
    model: outcome.model,
    sourceWatermark: windowInput.sourceWatermark,
    windowStart: windowInput.windowStart,
    sourceRowCount: windowInput.sourceRowCount,
    sourceRowIds: windowInput.sourceRowIds,
  });
}

/**
 * One sweep tick.
 *
 * @param invokeModel injectable model seam (tests, eval harness).
 */
export async function sweepRecentDaysDigests(
  prisma: PrismaClient,
  invokeModel?: SystemModelInvoker
): Promise<RecentDaysDigestSweepStats> {
  const stats = emptyStats();

  if (getSystemSetting('recentDaysDigestEnabled') === false) {
    stats.skipped = 'disabled';
    return stats;
  }
  const slugs = getSystemSetting('recentDaysDigestPersonalities');
  if (slugs.length === 0) {
    stats.skipped = 'no_personalities';
    return stats;
  }
  const route = resolveSystemModelRoute();
  if (route.provider !== AIProvider.ZaiCoding) {
    logRouteError(route.provider);
    stats.skipped = 'route';
    return stats;
  }

  const now = new Date();
  const pairs = await selectDigestCandidatePairs(prisma, {
    personalitySlugs: slugs,
    promptVersion: RECENT_DAYS_DIGEST_PROMPT_VERSION,
    limit: RECENT_DAYS_DIGEST.MAX_GENERATIONS_PER_SWEEP,
    now,
  });
  stats.selected = pairs.length;
  if (pairs.length === 0) {
    return stats;
  }

  const ids = await materializePendingRows(prisma, pairs);
  const invoke = invokeModel ?? makeRecentDaysDigestInvoker(route);

  for (const pair of pairs) {
    const id = ids.get(`${pair.personaId}:${pair.personalityId}`);
    if (id === undefined) {
      logger.warn(
        { personaId: pair.personaId, personalityId: pair.personalityId },
        'Recent-days digest pair had no materialized row — skipping'
      );
      stats.failedZeroSpend += 1;
      continue;
    }
    try {
      await processOnePair({ prisma, pair, id, invoke, stats, now });
    } catch (error) {
      // Transient by shape (rate limit, timeout, network, a blipped write) —
      // no attempt state is written, so the next tick retries.
      logger.warn(
        { err: error, personaId: pair.personaId, personalityId: pair.personalityId },
        'Recent-days digest pair failed'
      );
      stats.failedZeroSpend += 1;
    }
  }

  logger.info({ ...stats }, 'Recent-days digest sweep complete');
  return stats;
}
