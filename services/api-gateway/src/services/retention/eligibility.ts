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
 *
 * Phase 3 adds the sibling NOTIFY predicate (reachable + inactive + not yet
 * warned) in this same module for the same reason: the warning cohort, the
 * in-grace count, and the send-time re-check must share one definition. The
 * two predicates are disjoint by construction — see NOTIFY_CONDITIONS.
 */

import { Prisma } from '@tzurot/common-types/services/prisma';

/**
 * The single retention window (epic decision: ONE 180-day window, not the
 * rejected flat-90d). Inactivity is measured from last_active_at, falling back
 * to created_at when the tracking clock never stamped (NULL = "no known
 * activity", never "active now").
 */
export const RETENTION_WINDOW_DAYS = 180;

/**
 * The reachable branch's grace window (Phase 3, owner call): days between the
 * warning DM landing and purge eligibility. The privacy policy states this
 * number once the notify pipeline ships (its rewrite rides the same release
 * that first writes retention_notified_at) — changing it is a policy change,
 * not a tuning knob.
 */
export const GRACE_PERIOD_DAYS = 30;

/**
 * Why a user is purge-eligible: the two unreachable signals (D13), or a
 * warning-notice grace window that expired with no activity (Phase 3).
 */
export type PurgeReason = 'unreachable' | 'account_gone' | 'grace_expired';

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
  unreachable: boolean;
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
      (u.dm_undeliverable_since IS NOT NULL
       OR u.discord_account_gone_at IS NOT NULL
       OR u.retention_notified_at < now() - make_interval(days => ${GRACE_PERIOD_DAYS}))
  AND COALESCE(u.last_active_at, u.created_at)
        < now() - make_interval(days => ${RETENTION_WINDOW_DAYS})
  AND u.is_superuser = false
  AND u.retention_exempt = false
`;

/**
 * The reachable branch's notify predicate (Phase 3): who should receive a
 * retention warning DM. Disjoint from the purge cohort by construction — a
 * user with either unreachable stamp can't be DMed, and a non-null
 * retention_notified_at means the one notice was already sent (the IS NULL
 * clause is also the cross-run idempotency guard: re-running a notify run
 * resumes exactly where it stopped).
 */
const NOTIFY_CONDITIONS = Prisma.sql`
      u.dm_undeliverable_since IS NULL
  AND u.discord_account_gone_at IS NULL
  AND u.retention_notified_at IS NULL
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
    // Label precedence mirrors signal strength: a gone account beats
    // unreachable, and either unreachable stamp beats grace_expired (a user
    // whose notice bounced later carries both a grace clock and the stamp the
    // bounce wrote — the stamp is the operative reason).
    reason: row.accountGone ? 'account_gone' : row.unreachable ? 'unreachable' : 'grace_expired',
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
           (u.discord_account_gone_at IS NOT NULL) AS "accountGone",
           (u.dm_undeliverable_since IS NOT NULL) AS "unreachable"
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

export interface NotifyCohortRow {
  userId: string;
  discordId: string;
  inactiveSince: Date;
}

/**
 * The reachable-but-inactive cohort awaiting a warning DM, oldest first.
 *
 * `allowlist` is OUTBOUND_DM_ALLOWLIST narrowing at the SQL level (the
 * release-blast precedent): out-of-scope users never enter a run, so a dev
 * dry-run can never fabricate grace state about prod-shaped users. `null`
 * means unrestricted (prod).
 */
export async function selectNotifyCohort(
  db: Prisma.TransactionClient,
  allowlist: ReadonlySet<string> | null
): Promise<NotifyCohortRow[]> {
  const allowlistClause =
    allowlist === null
      ? Prisma.empty
      : Prisma.sql`AND u.discord_id = ANY(${[...allowlist]}::text[])`;
  return db.$queryRaw<NotifyCohortRow[]>`
    SELECT u.id AS "userId",
           u.discord_id AS "discordId",
           COALESCE(u.last_active_at, u.created_at) AS "inactiveSince"
    FROM users u
    WHERE ${NOTIFY_CONDITIONS} ${allowlistClause}
    ORDER BY COALESCE(u.last_active_at, u.created_at) ASC
  `;
}

/** How many users the notify predicate selects (un-narrowed — reporting). */
export async function countNotifyCohort(db: Prisma.TransactionClient): Promise<number> {
  const rows = await db.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM users u WHERE ${NOTIFY_CONDITIONS}
  `;
  return Number(rows[0]?.n ?? 0);
}

/**
 * How many users are mid-grace: notified, window not yet expired, and STILL
 * reachable. The reachability guards keep this disjoint from the purge cohort:
 * a mid-grace user whose LATER release DM bounces acquires an unreachable
 * stamp (nothing clears retention_notified_at except activity) and becomes
 * purge-eligible via that arm immediately — counting them here too would
 * report the same user as both purgeable-now and still-waiting. Any activity
 * clears retention_notified_at entirely, so every stamp this selects is a
 * live grace clock — no inactivity re-check needed. Superuser/exempt guards
 * kept for consistency with the sibling counts.
 */
export async function countInGrace(db: Prisma.TransactionClient): Promise<number> {
  const rows = await db.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM users u
    WHERE u.retention_notified_at >= now() - make_interval(days => ${GRACE_PERIOD_DAYS})
      AND u.dm_undeliverable_since IS NULL
      AND u.discord_account_gone_at IS NULL
      AND u.is_superuser = false
      AND u.retention_exempt = false
  `;
  return Number(rows[0]?.n ?? 0);
}

/**
 * The send-time re-check (the notify analogue of D4's TOCTOU close): of these
 * users, which are STILL notify-eligible? A user who became active between
 * cohort resolution and the worker picking up the batch must not be DMed a
 * deletion warning. Returns the still-eligible subset of `userIds`.
 */
export async function filterStillNotifyEligible(
  db: Prisma.TransactionClient,
  userIds: string[]
): Promise<Set<string>> {
  if (userIds.length === 0) {
    return new Set();
  }
  const rows = await db.$queryRaw<{ userId: string }[]>`
    SELECT u.id AS "userId"
    FROM users u
    WHERE u.id = ANY(${userIds}::uuid[]) AND ${NOTIFY_CONDITIONS}
  `;
  return new Set(rows.map(r => r.userId));
}
