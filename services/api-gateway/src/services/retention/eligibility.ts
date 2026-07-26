/**
 * THE retention eligibility predicate (Phase 2, D3/D4).
 *
 * D3 requires exactly ONE definition of "who is purge-eligible", consumed by the
 * preview, the nag, and the purge — so the count an operator reviews can never
 * drift from the set the purge acts on. This module holds it as a composable
 * SQL fragment plus the two shapes the callers need:
 *
 *   - `selectEligibleUsers` — the cohort (preview, nag, breaker)
 *   - `isStillEligibleForPurge` — the single-row form, run INSIDE the deletion
 *     transaction to close the preview→purge TOCTOU window (D4). A user who
 *     became active in between has cleared their unreachable flag or bumped
 *     `last_active_at`, and must not be erased.
 *
 * Both forms evaluate the same fragment, so the re-check cannot disagree with
 * the selection that produced the cohort.
 */

import { Prisma } from '@tzurot/common-types/services/prisma';

/**
 * The single retention window (epic decision: ONE 180-day window, not the
 * rejected flat-90d). Inactivity is measured from last_active_at, falling back
 * to created_at when the tracking clock never stamped (NULL = "no known
 * activity", never "active now").
 */
export const RETENTION_WINDOW_DAYS = 180;

/** Why a user is purge-eligible — the two unreachable signals (D13). */
export type PurgeReason = 'unreachable' | 'account_gone';

export interface PurgeCohortRow {
  userId: string;
  discordId: string;
  /** Effective inactivity anchor: last_active_at ?? created_at. */
  inactiveSince: Date;
  reason: PurgeReason;
}

interface CohortSqlRow {
  userId: string;
  discordId: string;
  inactiveSince: Date;
  accountGone: boolean;
}

/**
 * The eligibility conditions, over an aliased `users u`.
 *
 * `discord_account_gone_at` (Discord 10013) is an ALTERNATIVE unreachable
 * signal, not a fast-track: it still has to clear the 180-day inactivity bar.
 * D13 sketched a fast-track past that bar, but its stated safety mechanism —
 * a mis-stamped live user self-correcting via the activity clear — did not
 * exist when it was written, and 10013's false-positive rate has never been
 * measured. The clear ships alongside this (see the activity-stamp sites);
 * the fast-track stays unbuilt until the flag has run with a clearer.
 */
const ELIGIBILITY_CONDITIONS = Prisma.sql`
      (u.dm_undeliverable_since IS NOT NULL OR u.discord_account_gone_at IS NOT NULL)
  AND COALESCE(u.last_active_at, u.created_at)
        < now() - make_interval(days => ${RETENTION_WINDOW_DAYS})
  AND u.is_superuser = false
  AND u.retention_exempt = false
`;

/** Map a raw cohort row to the domain shape. */
function toCohortRow(row: CohortSqlRow): PurgeCohortRow {
  return {
    userId: row.userId,
    discordId: row.discordId,
    inactiveSince: row.inactiveSince,
    // A gone account is the stronger signal, so it wins the label when both
    // are stamped.
    reason: row.accountGone ? 'account_gone' : 'unreachable',
  };
}

/**
 * The purge-eligible cohort, oldest-inactive first.
 *
 * Unbounded by design: the cohort IS the answer, and truncating it would
 * under-report the very number the circuit breaker exists to police. The
 * breaker's percentage annotation is what flags an implausibly large result.
 */
export async function selectEligibleUsers(db: Prisma.TransactionClient): Promise<PurgeCohortRow[]> {
  const rows = await db.$queryRaw<CohortSqlRow[]>`
    SELECT u.id AS "userId",
           u.discord_id AS "discordId",
           COALESCE(u.last_active_at, u.created_at) AS "inactiveSince",
           (u.discord_account_gone_at IS NOT NULL) AS "accountGone"
    FROM users u
    WHERE ${ELIGIBILITY_CONDITIONS}
    ORDER BY COALESCE(u.last_active_at, u.created_at) ASC
  `;
  return rows.map(toCohortRow);
}

/** How many users the predicate currently selects (the breaker's numerator). */
export async function countEligibleUsers(db: Prisma.TransactionClient): Promise<number> {
  const rows = await db.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM users u WHERE ${ELIGIBILITY_CONDITIONS}
  `;
  return Number(rows[0]?.n ?? 0);
}

/**
 * Does this ONE user still satisfy the predicate? (D4's TOCTOU re-check.)
 *
 * Call this inside the erasure transaction — evaluating it beforehand would
 * reopen the very window it exists to close. Returns false both for a user who
 * became active and for a user who no longer exists (an already-purged target
 * is not eligible; the caller reports that as idempotent success, not an error).
 */
export async function isStillEligibleForPurge(
  db: Prisma.TransactionClient,
  userId: string
): Promise<boolean> {
  const rows = await db.$queryRaw<{ eligible: boolean }[]>`
    SELECT true AS eligible
    FROM users u
    WHERE u.id = ${userId}::uuid AND ${ELIGIBILITY_CONDITIONS}
  `;
  return rows.length > 0;
}
