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

/**
 * Consecutive billed failures, against one unchanged card, after which the
 * sweep stops re-admitting the row. A card whose text deterministically
 * produces an unparseable response would otherwise be re-selected and re-billed
 * every tick forever, and enough such rows saturate MAX_GENERATIONS_PER_SWEEP
 * so that nothing else ever generates. The freeze lifts the moment the card is
 * edited — the recorded failures were about a card that no longer exists.
 */
const MAX_BLURB_ATTEMPTS = 5;

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
  /**
   * Stale characters this tick's query returned — NOT the backlog depth. The
   * query carries its own LIMIT, so this saturates at MAX_GENERATIONS_PER_SWEEP
   * and says nothing about how many more are waiting. Do not build a
   * queue-depth alert on it.
   */
  staleFound: number;
  /** Stale characters marked current without a model call, their card being empty. */
  stampedEmpty: number;
  /** Blurbs generated and stored. */
  generated: number;
  /**
   * Rows whose model call was PAID FOR and produced nothing storable — the
   * response did not parse (a refusal, or non-JSON). Each of these also stamps
   * attempt state, so the row backs off instead of re-billing every tick.
   */
  failedBilled: number;
  /**
   * Rows that failed without spending tokens: a throw out of the model call
   * (rate limit, timeout, network), a blipped write, or the unreachable
   * missing-hash guard. No usage row is written for these, and no attempt state
   * either — they retry unchanged on the next tick.
   */
  failedZeroSpend: number;
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

  let stamped = 0;
  for (const row of rows) {
    try {
      // The `IS NULL` guard is not redundant with the SELECT above. The batch
      // is read once and written one row at a time, so a genuine edit can land
      // on a row between its read and its turn — and that edit stamps correctly
      // from its own returned row. Without the guard this loop would then
      // overwrite the correct stamp with a hash of the pre-edit snapshot,
      // leaving card_source_hash meaning something other than "the digest of
      // this row's card" until the next edit. The guard makes the backfill a
      // no-op against any row a real write reached first.
      const affected = await prisma.$executeRaw`
        UPDATE personalities
        SET card_source_hash = ${hashRosterBlurbCard(row)}
        WHERE id = ${row.id}::uuid AND card_source_hash IS NULL
      `;
      // Counted only when the row actually moved. The guard above turns this
      // into a silent no-op when a real write stamped the row first — no throw,
      // just zero rows affected — so incrementing unconditionally would report
      // the same false progress the catch below exists to prevent, by a quieter
      // route. `$executeRaw` resolving to the affected-row count is pinned by a
      // component test against real Postgres, not assumed.
      if (affected > 0) {
        stamped += 1;
      }
    } catch (error) {
      // Same isolation as the generation loop: one row's write blip must not
      // cost the tick. The row keeps its null hash and the next tick retries.
      logger.warn({ err: error, personalityId: row.id }, 'Card hash stamp failed');
    }
  }
  // Rows actually stamped: neither a thrown write nor a guard-no-op counts. A
  // persistently failing row must not look like a draining backfill.
  return stamped;
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
 *
 * A store also CLEARS this row's failure state, atomically with the write that
 * makes the row current — including the empty-card stamp, whose whole point is
 * that this card will never need a model call again.
 */
async function storeBlurb(
  prisma: PrismaClient,
  personalityId: string,
  blurb: string,
  sourceHash: string
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE personalities
    SET roster_blurb = ${blurb}, roster_blurb_source_hash = ${sourceHash},
        roster_blurb_attempts = 0,
        roster_blurb_last_failed_at = NULL,
        roster_blurb_failed_source_hash = NULL
    WHERE id = ${personalityId}::uuid
  `;
}

/**
 * Stamp one billed failure onto the row it was billed for.
 *
 * RAW SQL for exactly the reason `storeBlurb` above documents: `personalities`
 * is sync-tracked and reconciled last-write-wins on `updated_at`, so a Prisma
 * `update()` here would let a failure stamp out-rank a genuine card edit made
 * in the other environment.
 *
 * The CASE keys the count to one exact card. A failure previously recorded
 * against a different hash — or none at all — is about a card that no longer
 * exists, so the count restarts at 1 rather than inheriting a stranger's
 * history and freezing the new card early.
 */
async function recordGenerationFailure(
  prisma: PrismaClient,
  personalityId: string,
  cardHash: string
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE personalities
    SET roster_blurb_attempts = CASE
          WHEN roster_blurb_failed_source_hash = ${cardHash} THEN roster_blurb_attempts + 1
          ELSE 1
        END,
        roster_blurb_failed_source_hash = ${cardHash},
        roster_blurb_last_failed_at = NOW()
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
  usage: { tokensIn: number; tokensOut: number; provider: string; model: string },
  personalityId: string
): Promise<void> {
  try {
    const createdAt = new Date();
    // The model the call resolved at ITS start, not whatever the live setting
    // says now — an admin can change extractionModel during a 60s call, and
    // re-reading it here would bill this generation to the wrong model.
    const model = usage.model;
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
        personalityId,
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
 *
 * The second half of the WHERE clause is the failure-backoff admission gate,
 * and its invariants are:
 *
 * - A row that has never failed carries a null `roster_blurb_failed_source_hash`
 *   while `card_source_hash` is non-null, so `IS DISTINCT FROM` is TRUE and the
 *   row is admitted by the first arm alone. The happy path pays nothing for
 *   this gate.
 * - A card EDIT after failures changes `card_source_hash`, which no longer
 *   equals the recorded failed hash — the first arm is TRUE again and the row
 *   is re-admitted immediately, with no wait.
 * - Otherwise the row waits `1 hour * 2^(attempts - 1)` from its last failure:
 *   1h, then 2h, 4h, 8h. `attempts` is at least 1 wherever this arm is
 *   evaluated, because every row still at 0 has a null failed hash and was
 *   already admitted above.
 * - At `attempts = MAX_BLURB_ATTEMPTS` the arm is false for all time, so the
 *   row is frozen until its card is edited. That is the point: repeated spend
 *   on a card that deterministically fails buys nothing.
 *
 * A null `roster_blurb_last_failed_at` cannot smuggle a row through: `NOW() >=
 * NULL + interval` is NULL, which is not TRUE, so the arm excludes it. That is
 * the correct outcome ONLY because the first arm has already admitted every
 * never-failed row — the two arms are read together, not independently.
 */
async function findStale(prisma: PrismaClient): Promise<{ id: string }[]> {
  return prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM personalities
    WHERE card_source_hash IS NOT NULL
      AND roster_blurb_source_hash IS DISTINCT FROM card_source_hash
      AND (
        roster_blurb_failed_source_hash IS DISTINCT FROM card_source_hash
        OR (
          roster_blurb_attempts < ${MAX_BLURB_ATTEMPTS}
          AND NOW() >= roster_blurb_last_failed_at + (interval '1 hour' * power(2, roster_blurb_attempts - 1))
        )
      )
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
    failedBilled: 0,
    failedZeroSpend: 0,
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
    // Already bounded by `stale.length`, which the stale query's own LIMIT
    // caps — this is the belt to that suspenders, and keeps the repo's
    // every-findMany-carries-a-take rule true by inspection.
    take: MAX_GENERATIONS_PER_SWEEP,
  })) as StampedCardRow[];

  for (const row of rows) {
    const hash = row.cardSourceHash;
    if (hash === null) {
      // Unreachable while findStale filters on card_source_hash IS NOT NULL.
      // Counted and logged rather than skipped silently, so a future query
      // change surfaces as a visible failure instead of a tick that quietly
      // converges slower than its stats claim.
      logger.warn({ personalityId: row.id }, 'Stale row had no card hash — skipping');
      stats.failedZeroSpend += 1;
      continue;
    }

    // EVERY per-row action sits inside this try, including the empty-card
    // write. An earlier revision guarded only the model call, then only the
    // generation branch — leaving the empty-card store outside, where a blipped
    // write escaped the loop and cost the rest of the tick. The isolation this
    // provides is worth nothing if it is not uniform, so the shape to keep is
    // "one try around the whole row", not "a try around the risky-looking bit".
    try {
      // A card with nothing describable is marked current without a model call
      // — paying for a blurb about nothing, once per tick forever, is the
      // failure this short-circuit exists to prevent.
      if (hash === EMPTY_ROSTER_BLURB_CARD_HASH) {
        await storeBlurb(prisma, row.id, '', hash);
        stats.stampedEmpty += 1;
        continue;
      }

      const { blurb, usage } = await generateRosterBlurb(row, invokeModel);
      // Billed BEFORE the store, and deliberately: the tokens are spent either
      // way, so a store failure must not erase the record of what it cost. If
      // the store then fails, the next tick regenerates and writes a second
      // usage row — which is accurate, not double-counting, because the model
      // genuinely ran twice.
      await logUsage(prisma, row.ownerId, usage, row.id);
      if (blurb === null) {
        // Billed, and nothing storable came back. The stamp is what makes this
        // row back off: without it a card whose text deterministically produces
        // an unparseable response is re-selected and re-billed on every tick,
        // forever, and crowds out every other stale row while doing it.
        await recordGenerationFailure(prisma, row.id, hash);
        stats.failedBilled += 1;
        continue;
      }
      await storeBlurb(prisma, row.id, blurb, hash);
      stats.generated += 1;
    } catch (error) {
      // Transient by shape (rate limit, timeout, network, a blipped write) and
      // the row stays stale, so the next tick retries it. No usage row when the
      // MODEL call throws: it carries no token counts, so there is nothing to
      // bill.
      //
      // Deliberately NO attempt stamp on this path. These failures spend
      // nothing, and the cap exists to stop repeated SPEND — marching
      // outage-hit rows toward a permanent freeze would convert one provider
      // blip into every character's blurb being stuck until someone edited each
      // card by hand. Every-tick retry is the correct behaviour for a failure
      // that costs nothing.
      logger.warn({ err: error, personalityId: row.id }, 'Roster blurb row failed');
      stats.failedZeroSpend += 1;
    }
  }

  logger.info({ ...stats }, 'Roster blurb sweep complete');
  return stats;
}
