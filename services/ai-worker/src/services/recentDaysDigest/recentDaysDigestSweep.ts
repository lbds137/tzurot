/**
 * Recent-days digest sweep — the generation half of the design.
 *
 * One tick selects up to `MAX_GENERATIONS_PER_SWEEP` due (persona,
 * personality) pairs (the single selection query in
 * `recentDaysDigestSelection.ts`, shared with the tooling dry-run),
 * materializes a row for every never-generated pair, then generates
 * sequentially — same one-try-around-the-whole-row shape as
 * `rosterBlurbSweep.ts`, and the same never-log-content discipline
 * (`00-critical.md` § Logging).
 */

import { AIProvider } from '@tzurot/common-types/constants/ai';
import { MessageRole } from '@tzurot/common-types/constants/message';
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
import { createLogger } from '@tzurot/common-types/utils/logger';
import { countTextTokens } from '@tzurot/common-types/utils/tokenCounter';
import { extractJsonPayload } from '../extraction/extractionPrompt.js';
import {
  resolveSystemModelRoute,
  type SystemModelInvoker,
  type SystemModelResult,
} from '../systemModel/systemModelCall.js';
import { makeRecentDaysDigestInvoker } from './makeRecentDaysDigestInvoker.js';
import { buildDigestInput, type DigestSourceRow } from './recentDaysDigestInput.js';
import {
  buildDigestPrompt,
  buildRegenerateDigestPrompt,
  buildDigestRegenerationFeedback,
  digestResponseSchema,
  type DigestPromptInput,
} from './recentDaysDigestPrompt.js';
import {
  materializePendingRows,
  storeDigestSuccess,
  recordDigestFailure,
  readDigestStatus,
} from './recentDaysDigestStore.js';
import { decideDigestLength, validateDigest } from './recentDaysDigestValidation.js';
import { writeRecentDaysDigestUsageLog } from './recentDaysDigestUsageLog.js';

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

interface RawSourceRow {
  id: string;
  role: string;
  content: string;
  created_at: Date;
  channel_id: string;
  guild_id: string | null;
}

/** Load one pair's window, newest-first, capped at `MAX_SOURCE_MESSAGES + 1`
 *  — the `+1` is how `buildDigestInput` detects truncation without a
 *  separate count query. */
async function loadWindowRows(
  prisma: PrismaClient,
  pair: DigestCandidatePair,
  now: Date
): Promise<DigestSourceRow[]> {
  const windowFloor = new Date(now.getTime() - RECENT_DAYS_DIGEST.WINDOW_DAYS * 86_400_000);
  const floor = pair.epoch !== null && pair.epoch > windowFloor ? pair.epoch : windowFloor;
  const rows = await prisma.$queryRaw<RawSourceRow[]>`
    SELECT id, role, content, created_at, channel_id, guild_id
    FROM conversation_history
    WHERE persona_id = ${pair.personaId}::uuid AND personality_id = ${pair.personalityId}::uuid
      AND deleted_at IS NULL AND created_at >= ${floor}::timestamptz
    ORDER BY created_at DESC
    LIMIT ${RECENT_DAYS_DIGEST.MAX_SOURCE_MESSAGES + 1}
  `;
  return rows.map(row => ({
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
    channelId: row.channel_id,
    guildId: row.guild_id,
  }));
}

/** One model call + usage row + JSON parse. Returns null on a parse failure
 *  — a parse failure is terminal on whichever pass produced it, mirroring
 *  the memory-archive summarizer (no regeneration is attempted FOR a parse
 *  failure itself). */
async function callAndParse(
  prisma: PrismaClient,
  invoke: SystemModelInvoker,
  prompt: string,
  pair: DigestCandidatePair
): Promise<{ digest: string; usage: SystemModelResult } | null> {
  const start = Date.now();
  const usage = await invoke(prompt);
  const latencyMs = Date.now() - start;
  await writeRecentDaysDigestUsageLog(
    prisma,
    usage,
    { personalityId: pair.personalityId, ownerId: pair.ownerId },
    latencyMs
  );

  let payload: unknown;
  try {
    payload = JSON.parse(extractJsonPayload(usage.content));
  } catch {
    payload = undefined;
  }
  const parsed = payload === undefined ? undefined : digestResponseSchema.safeParse(payload);
  return parsed?.success === true ? { digest: parsed.data.digest, usage } : null;
}

interface FinishArgs {
  prisma: PrismaClient;
  id: string;
  pair: DigestCandidatePair;
  stats: RecentDaysDigestSweepStats;
}

/** Apply the guarded failure write and classify the outcome into stats. */
async function finishFailure(
  args: FinishArgs & { attemptedWatermark: Date | null; errorClass: DigestFailureClass }
): Promise<void> {
  const { prisma, id, pair, stats, attemptedWatermark, errorClass } = args;
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
  const status = await readDigestStatus(prisma, id);
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

/** The model round for one pair: first pass, at most one regeneration, then
 *  the final write. Split out of `processOnePair` to stay under the
 *  per-function line/statement limits. */
async function runGeneration(ctx: {
  prisma: PrismaClient;
  pair: DigestCandidatePair;
  id: string;
  invoke: SystemModelInvoker;
  promptInput: DigestPromptInput;
  assistantContents: string[];
  windowInput: {
    windowStart: Date;
    sourceWatermark: Date;
    sourceRowCount: number;
    sourceRowIds: string[];
  };
  stats: RecentDaysDigestSweepStats;
}): Promise<void> {
  const { prisma, pair, id, invoke, promptInput, assistantContents, windowInput, stats } = ctx;

  const first = await callAndParse(prisma, invoke, buildDigestPrompt(promptInput), pair);
  if (first === null) {
    await finishFailure({
      prisma,
      id,
      pair,
      stats,
      attemptedWatermark: windowInput.sourceWatermark,
      errorClass: 'parse_failure',
    });
    return;
  }

  const firstValidation = validateDigest(first.digest, assistantContents);
  const firstLength = decideDigestLength(countTextTokens(first.digest));
  const needsRegen = !firstValidation.ok || firstLength === 'over_soft';

  const final = needsRegen
    ? await callAndParse(
        prisma,
        invoke,
        buildRegenerateDigestPrompt(
          promptInput,
          first.digest,
          buildDigestRegenerationFeedback({
            overLength: firstLength !== 'within_soft',
            firstPerson: !firstValidation.ok && firstValidation.cls === 'first_person',
            quoted:
              !firstValidation.ok && firstValidation.cls === 'quotation'
                ? firstValidation.detail
                : null,
          })
        ),
        pair
      )
    : first;

  if (final === null) {
    await finishFailure({
      prisma,
      id,
      pair,
      stats,
      attemptedWatermark: windowInput.sourceWatermark,
      errorClass: 'parse_failure',
    });
    return;
  }

  const finalValidation = validateDigest(final.digest, assistantContents);
  if (!finalValidation.ok) {
    await finishFailure({
      prisma,
      id,
      pair,
      stats,
      attemptedWatermark: windowInput.sourceWatermark,
      errorClass: finalValidation.cls,
    });
    return;
  }

  await finishSuccess({
    prisma,
    id,
    pair,
    stats,
    text: final.digest,
    model: final.usage.model,
    sourceWatermark: windowInput.sourceWatermark,
    windowStart: windowInput.windowStart,
    sourceRowCount: windowInput.sourceRowCount,
    sourceRowIds: windowInput.sourceRowIds,
  });
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
  const names = {
    personaLabel: pair.personaPreferredName ?? pair.personaName,
    characterLabel: pair.personalityDisplayName ?? pair.personalityName,
  };
  const windowInput = buildDigestInput({ rows, tz: pair.ownerTimezone, names });
  const promptInput: DigestPromptInput = {
    personaLabel: names.personaLabel,
    characterLabel: names.characterLabel,
    lines: windowInput.lines,
    truncated: windowInput.truncated,
    windowStart: windowInput.windowStart,
    tz: pair.ownerTimezone,
  };
  const assistantContents = rows
    .filter(row => row.role === (MessageRole.Assistant as string))
    .map(row => row.content);

  await runGeneration({
    prisma,
    pair,
    id,
    invoke,
    promptInput,
    assistantContents,
    windowInput,
    stats,
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
