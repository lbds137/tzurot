/**
 * Roster-blurb sweep — the generation half of TASK-660 slice B.
 *
 * The sweep does NOT discover staleness. Every write path that can change a
 * character card stamps `card_source_hash` at the moment of the edit, so
 * "which blurbs are stale" is a plain SQL comparison against
 * `roster_blurb_source_hash` — the sweep asks the database for the stale rows
 * and gets exactly those, nothing more. No card is ever rehashed to find out
 * that it changed, and nothing is hashed on the request path.
 *
 * The one exception is the STAMPING PASS below, which exists only because rows
 * written before the column did have no stamp. It drains once and then returns
 * zero rows forever.
 *
 * Generation runs here rather than at the edit itself so api-gateway needs no
 * coupling to ai-worker's job wiring, and so a dropped or failed generation
 * self-heals on the next tick instead of being lost with the request.
 */

import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { getSystemSetting } from '@tzurot/common-types/services/SystemSettingsService';
import { generateUsageLogUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { createLogger } from '@tzurot/common-types/utils/logger';
import {
  EMPTY_ROSTER_BLURB_CARD_HASH,
  hashRosterBlurbCard,
  ROSTER_BLURB_CARD_FIELDS,
  type RosterBlurbCard,
} from '@tzurot/common-types/utils/rosterBlurbCard';
import { generateRosterBlurb } from '../services/rosterBlurb/RosterBlurbGenerator.js';
import type { SystemModelInvoker } from '../services/systemModel/systemModelCall.js';

const logger = createLogger('RosterBlurbSweep');

/**
 * Rows the one-time stamping pass fills per tick.
 *
 * Only pre-existing rows land here, and only until they are all stamped, so
 * this bounds a migration rather than steady-state work. Each row costs one
 * hash and one UPDATE round trip and no model call, so the batch is sized to
 * bound a tick's wall-clock on the single-concurrency scheduled worker rather
 * than to drain fast. Draining fast would buy nothing anyway: generation moves
 * at MAX_GENERATIONS_PER_SWEEP per tick, which is the real floor on how long a
 * first backfill takes.
 */
const STAMP_BATCH_SIZE = 200;

/**
 * Stale rows examined per tick, and therefore the ceiling on model calls: at
 * the sweep's cron cadence this is the most the feature can cost in a period,
 * no matter how many characters exist or how fast their cards churn. Not an
 * exact call count — an empty card consumes a slot and pays nothing.
 */
const MAX_GENERATIONS_PER_SWEEP = 10;

/** The card columns, plus the row identity and the owner the usage row bills. */
const CARD_SELECT = {
  id: true,
  ownerId: true,
  ...Object.fromEntries(ROSTER_BLURB_CARD_FIELDS.map(key => [key, true])),
} as const;

/** As above, plus the stamp — what generation needs and stamping does not. */
const CARD_SELECT_WITH_HASH = { ...CARD_SELECT, cardSourceHash: true } as const;

interface CardRow extends RosterBlurbCard {
  id: string;
  ownerId: string;
}

interface StampedCardRow extends CardRow {
  /** Non-null in practice — `findStale` only returns stamped rows. */
  cardSourceHash: string | null;
}

export interface RosterBlurbSweepStats {
  /** False when the runtime switch is off — every other count is then zero. */
  enabled: boolean;
  /** Pre-existing rows given their first `card_source_hash` this tick. */
  stamped: number;
  /** Stale characters the database returned — may exceed what this tick got to. */
  staleFound: number;
  /** Stale characters marked current without a model call, their card being empty. */
  stampedEmpty: number;
  /** Blurbs generated and stored. */
  generated: number;
  /** Model calls whose response failed to parse — nothing stored, retried next tick. */
  failed: number;
}

/**
 * Give pre-existing rows their first card stamp.
 *
 * This is the only place the sweep hashes a card it was not already about to
 * summarize, and it is transitional: `card_source_hash IS NULL` matches only
 * rows that predate the column, because every write path has stamped it since.
 * Once drained the query returns nothing and the pass costs one indexed lookup
 * per tick.
 *
 * A freshly stamped row IS eligible for generation in the same tick: its
 * `roster_blurb_source_hash` is still null, and `NULL IS DISTINCT FROM
 * 'somehash'` is TRUE, so it satisfies the stale predicate immediately. That
 * is fine for spend (the query's own LIMIT is the bound) but it means legacy
 * backfill competes with genuine edits for the same per-tick budget — which
 * `findStale`'s ORDER BY resolves in the edits' favour. Verified against real
 * SQL in the PGLite component test, not asserted from reading.
 */
async function stampMissingHashes(prisma: PrismaClient): Promise<number> {
  const rows = (await prisma.personality.findMany({
    where: { cardSourceHash: null },
    select: CARD_SELECT,
    take: STAMP_BATCH_SIZE,
  })) as CardRow[];

  for (const row of rows) {
    // The `IS NULL` guard is not redundant with the SELECT above. The batch is
    // read once and written one row at a time, so a genuine edit can land on a
    // row between its read and its turn — and that edit stamps correctly from
    // its own returned row. Without the guard this loop would then overwrite
    // the correct stamp with a hash of the pre-edit snapshot, leaving
    // card_source_hash meaning something other than "the digest of this row's
    // card" until the next edit. The guard makes the backfill a no-op against
    // any row a real write reached first.
    await prisma.$executeRaw`
      UPDATE personalities
      SET card_source_hash = ${hashRosterBlurbCard(row)}
      WHERE id = ${row.id}::uuid AND card_source_hash IS NULL
    `;
  }
  return rows.length;
}

/**
 * Persist a generated blurb and the hash it describes.
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
 * The stale set, straight from the database.
 *
 * `IS DISTINCT FROM` rather than `!=` because either side can be null and SQL
 * `!=` yields null (not true) when one is — a never-generated blurb would then
 * never be selected, which is precisely the row that most needs generating.
 * Rows with no stamp yet are excluded here and belong to the stamping pass.
 *
 * ORDER BY puts rows that ALREADY have a blurb first. Those are edits to
 * characters whose blurb is on screen right now and has gone wrong; a
 * never-generated row has nothing to be wrong. Without it, a first-run backfill
 * of a large table would spend every tick's budget on legacy rows in whatever
 * order the planner returned, and a card edited during that window would wait
 * behind all of them. Postgres sorts `false` before `true`, so the null-hash
 * rows land last.
 */
async function findStale(prisma: PrismaClient): Promise<{ id: string }[]> {
  return prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM personalities
    WHERE card_source_hash IS NOT NULL
      AND roster_blurb_source_hash IS DISTINCT FROM card_source_hash
    ORDER BY (roster_blurb_source_hash IS NULL)
    LIMIT ${MAX_GENERATIONS_PER_SWEEP}
  `;
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
    stamped: 0,
    staleFound: 0,
    stampedEmpty: 0,
    generated: 0,
    failed: 0,
  };
  if (!stats.enabled) {
    return stats;
  }

  stats.stamped = await stampMissingHashes(prisma);

  const stale = await findStale(prisma);
  stats.staleFound = stale.length;
  if (stale.length === 0) {
    return stats;
  }

  // One read for the whole batch. The card fields and the stamp come from the
  // SAME row snapshot, and the write paths stamp atomically with the fields
  // they change — so the stamp read here is the digest OF this card, and the
  // sweep never has to recompute one to store it. That is the whole point of
  // stamping at write time; recomputing here would quietly reintroduce the
  // reader-side hash this design removes.
  const rows = (await prisma.personality.findMany({
    where: { id: { in: stale.map(r => r.id) } },
    select: CARD_SELECT_WITH_HASH,
  })) as StampedCardRow[];

  for (const row of rows) {
    const hash = row.cardSourceHash;
    if (hash === null) {
      continue;
    }

    // A card with nothing describable is marked current without a model call —
    // paying for a blurb about nothing, once per tick forever, is the failure
    // this short-circuit exists to prevent.
    if (hash === EMPTY_ROSTER_BLURB_CARD_HASH) {
      await storeBlurb(prisma, row.id, '', hash);
      stats.stampedEmpty += 1;
      continue;
    }

    // Per-row, so one flaky character cannot starve the rest of the tick. The
    // throw shapes here are transient (rate limit, timeout, network) and the
    // row stays stale, so the next tick retries it — unlike fact extraction,
    // this job has nothing to lose by simply trying again, which is why it
    // needs no busy-category classification of its own.
    //
    // No usage row on this path, deliberately: a throw carries no token counts,
    // so there is nothing to bill. That under-reports a provider error that
    // charged us anyway, which is the honest direction to be wrong in.
    let generation;
    try {
      generation = await generateRosterBlurb(row, invokeModel);
    } catch (error) {
      logger.warn({ err: error, personalityId: row.id }, 'Roster blurb model call threw');
      stats.failed += 1;
      continue;
    }

    const { blurb, usage } = generation;
    await logUsage(prisma, row.ownerId, usage, row.id);
    if (blurb === null) {
      stats.failed += 1;
      continue;
    }
    await storeBlurb(prisma, row.id, blurb, hash);
    stats.generated += 1;
  }

  logger.info({ ...stats }, 'Roster blurb sweep complete');
  return stats;
}
