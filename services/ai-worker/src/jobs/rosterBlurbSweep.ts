/**
 * Roster-blurb sweep — the generation half of TASK-660 slice B.
 *
 * Runs as a repeatable job on the existing scheduled-jobs queue rather than
 * behind its own BullMQ queue, and off the request path entirely. The
 * alternative shape (hash the card at prompt-build time, enqueue on mismatch)
 * would put a card-wide fetch and a hash on every turn's blocking path to
 * discover a mismatch that changes only when someone edits a character. A
 * periodic sweep pays that cost once per tick for everyone, and the worst case
 * it introduces is a blurb up to one tick stale — which the render side
 * already degrades gracefully around.
 *
 * Bounded on both axes so a tick can never become a spend event: the scan
 * reads a fixed page of candidates, and at most MAX_GENERATIONS_PER_SWEEP of
 * them reach the model. A character whose card churns faster than the sweep
 * simply regenerates on a later tick.
 */

import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { getSystemSetting } from '@tzurot/common-types/services/SystemSettingsService';
import { generateUsageLogUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { generateRosterBlurb } from '../services/rosterBlurb/RosterBlurbGenerator.js';
import {
  buildRosterBlurbCard,
  CARD_FIELDS,
  EMPTY_ROSTER_BLURB_CARD_HASH,
  hashRosterBlurbCard,
  type RosterBlurbCard,
} from '../services/rosterBlurb/rosterBlurbPrompt.js';
import type { SystemModelInvoker } from '../services/systemModel/systemModelCall.js';

const logger = createLogger('RosterBlurbSweep');

/**
 * Candidates examined per tick, per query. Reading a card is cheap (no model
 * call), so this is sized to cover an ordinary edit rate rather than to bound
 * cost — the cost bound is MAX_GENERATIONS_PER_SWEEP below.
 */
const SCAN_PAGE_SIZE = 200;

/**
 * Model calls per tick. The hard spend bound: at the sweep's cron cadence this
 * is the most the feature can cost in a period, no matter how many characters
 * exist or how fast their cards churn.
 */
const MAX_GENERATIONS_PER_SWEEP = 10;

/** Columns the sweep reads: the card, its stored hash, and the billing owner. */
const CANDIDATE_SELECT = {
  id: true,
  ownerId: true,
  rosterBlurbSourceHash: true,
  ...Object.fromEntries(CARD_FIELDS.map(field => [field.key, true])),
} as const;

interface Candidate extends RosterBlurbCard {
  id: string;
  ownerId: string;
  rosterBlurbSourceHash: string | null;
}

export interface RosterBlurbSweepStats {
  /** False when the runtime switch is off — every other count is then zero. */
  enabled: boolean;
  /** Distinct characters whose card was hashed this tick. */
  scanned: number;
  /** Of those, how many had a hash that no longer matches their card. */
  stale: number;
  /** Stale characters stamped without a model call because their card is empty. */
  stampedEmpty: number;
  /** Blurbs generated and stored. */
  generated: number;
  /** Model calls whose response failed to parse — nothing stored, retried next tick. */
  failed: number;
}

/**
 * Persist a generated blurb and the hash it was generated from.
 *
 * RAW SQL on purpose. `personalities` is sync-tracked and dev↔prod
 * reconciliation is last-write-wins on `updated_at`
 * (`.claude/rules/03-database.md` § Sync-Tracked Tables), so a Prisma
 * `update()` here would bump that stamp and let a machine-generated blurb win
 * the next sync over a genuine card edit made in the other environment. The
 * consequence is that a blurb does not itself propagate across environments —
 * accepted, because each environment's sweep generates its own, and losing an
 * owner's edit is the strictly worse failure.
 */
async function storeBlurb(
  prisma: PrismaClient,
  personalityId: string,
  blurb: string,
  sourceHash: string
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE personalities
    SET roster_blurb = ${blurb}, roster_blurb_source_hash = ${sourceHash}
    WHERE id = ${personalityId}::uuid
  `;
}

/**
 * Record one usage row per model call, attributed to the character's owner.
 *
 * Fail-soft, and written for a FAILED parse too: the tokens were spent either
 * way, and a ledger that only counts successes under-reports the feature's
 * real cost — which is the one number this row exists to make queryable.
 */
async function logUsage(
  prisma: PrismaClient,
  ownerId: string,
  usage: { tokensIn: number; tokensOut: number; provider: string },
  personalityId: string
): Promise<void> {
  try {
    const createdAt = new Date();
    const model = getSystemSetting('extractionModel');
    await prisma.usageLog.create({
      data: {
        id: generateUsageLogUuid(ownerId, model, createdAt),
        userId: ownerId,
        provider: usage.provider,
        model,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        requestType: 'roster_blurb',
        createdAt,
      },
    });
  } catch (error) {
    logger.warn({ err: error, personalityId }, 'Roster blurb usage row failed — continuing');
  }
}

/**
 * Collect this tick's candidates.
 *
 * TWO queries, deduped, because neither alone reaches every stale character.
 * The never-generated set is found by a null hash — those may be arbitrarily
 * old, so recency ordering would never reach them. Everything else goes stale
 * only by being edited, and an edit bumps `updatedAt`, so the recent page
 * catches it. A character that is neither recently edited nor missing a hash
 * cannot be stale.
 */
async function collectCandidates(prisma: PrismaClient): Promise<Candidate[]> {
  const [neverGenerated, recentlyEdited] = await Promise.all([
    prisma.personality.findMany({
      where: { rosterBlurbSourceHash: null },
      select: CANDIDATE_SELECT,
      take: SCAN_PAGE_SIZE,
    }),
    prisma.personality.findMany({
      select: CANDIDATE_SELECT,
      orderBy: { updatedAt: 'desc' },
      take: SCAN_PAGE_SIZE,
    }),
  ]);

  const byId = new Map<string, Candidate>();
  for (const row of [...neverGenerated, ...recentlyEdited] as Candidate[]) {
    byId.set(row.id, row);
  }
  return [...byId.values()];
}

/**
 * One sweep tick.
 *
 * @param invokeModel injectable model seam (tests, eval harness).
 */
export async function sweepRosterBlurbs(
  prisma: PrismaClient,
  invokeModel?: SystemModelInvoker
): Promise<RosterBlurbSweepStats> {
  const stats: RosterBlurbSweepStats = {
    enabled: getSystemSetting('rosterBlurbEnabled'),
    scanned: 0,
    stale: 0,
    stampedEmpty: 0,
    generated: 0,
    failed: 0,
  };
  if (!stats.enabled) {
    return stats;
  }

  const candidates = await collectCandidates(prisma);
  stats.scanned = candidates.length;

  for (const candidate of candidates) {
    if (stats.generated + stats.failed >= MAX_GENERATIONS_PER_SWEEP) {
      break;
    }

    const card = buildRosterBlurbCard(candidate);
    const hash = hashRosterBlurbCard(card);
    if (hash === candidate.rosterBlurbSourceHash) {
      continue;
    }
    stats.stale += 1;

    // A card with nothing describable gets stamped, never summarized — paying
    // for a blurb about nothing, once per tick forever, is the failure this
    // short-circuit exists to prevent.
    if (hash === EMPTY_ROSTER_BLURB_CARD_HASH) {
      await storeBlurb(prisma, candidate.id, '', hash);
      stats.stampedEmpty += 1;
      continue;
    }

    const { blurb, usage } = await generateRosterBlurb(card, invokeModel);
    await logUsage(prisma, candidate.ownerId, usage, candidate.id);
    if (blurb === null) {
      stats.failed += 1;
      continue;
    }
    await storeBlurb(prisma, candidate.id, blurb, hash);
    stats.generated += 1;
  }

  logger.info({ ...stats }, 'Roster blurb sweep complete');
  return stats;
}
