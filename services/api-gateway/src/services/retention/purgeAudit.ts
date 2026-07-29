/**
 * The retention purge audit ledger (Phase 2, D14/D15).
 *
 * One `retention_purge_log` row per purge attempt. It is BOTH the immutable
 * audit trail (diagnosing a "my data disappeared" report, demonstrating the
 * retention policy is actually enforced) AND the off-DB retry queue — the
 * row's `offDbReconciled` status is the DLQ D15 asked for, which is why there
 * is one table here and not two.
 *
 * **The success row is written INSIDE the erasure transaction.** Writing it
 * afterwards would leave a window where a process death between commit and
 * log-write produces a purged account with no ledger entry — the one outcome an
 * audit trail exists to make impossible. The table deliberately has no FK to
 * `users` (the purge deletes that row), so it survives the cascade it records.
 *
 * **Ordering note — a deliberate refinement of D15.** D15 preferred running the
 * off-DB cleanup BEFORE the DB delete, so a failed transaction would leave only
 * harmless orphaned cleanup. That is not implementable: the off-DB work is a
 * function of the transaction's outcome (which characters were re-homed and so
 * must KEEP their avatars, versus which were deleted and must lose them), so it
 * cannot precede it. The durable retry handle D15 actually wanted is this row's
 * `pending` status plus `offDbPending`, which is what makes DB-first ordering
 * safe: an off-DB failure leaves a record naming exactly what still needs doing.
 */

import { Prisma, type PrismaClient } from '@tzurot/common-types/services/prisma';

/**
 * What the reconciliation sweep still has to retry.
 *
 * Avatar slugs ONLY. The other off-DB effects self-heal: Redis session keys
 * TTL-expire and the user/personality caches expire (~1h) or are re-broadcast
 * by any later invalidation. A deleted character's avatar file has no such
 * fallback — left behind, it stays publicly downloadable forever — so it is the
 * single off-DB step worth persisting a retry for.
 */
export interface OffDbPending {
  characterSlugs: string[];
}

export interface PurgeAuditInsert {
  targetDiscordId: string;
  /** Operator/run label identifying who or what triggered the purge run. */
  runContext: string | null;
  /** The AccountDeletionSummary's per-table counts. */
  deletionCounts: Prisma.InputJsonValue;
  offDbPending: OffDbPending;
}

/** A row the reconciliation sweep must retry. */
export interface PendingOffDbRow {
  id: string;
  targetDiscordId: string;
  characterSlugs: string[];
}

/**
 * Record a committed purge. Call with a TRANSACTION client from inside the
 * erasure transaction — the row must commit atomically with the deletion it
 * describes. Returns the ledger row id so the caller can settle it once the
 * off-DB steps have run.
 */
export async function recordPurgeSuccess(
  tx: Prisma.TransactionClient,
  entry: PurgeAuditInsert
): Promise<string> {
  const row = await tx.retentionPurgeLog.create({
    data: {
      targetDiscordId: entry.targetDiscordId,
      runContext: entry.runContext,
      deletionCounts: entry.deletionCounts,
      dbOutcome: 'success',
      offDbReconciled: 'pending',
      offDbPending: { characterSlugs: entry.offDbPending.characterSlugs },
    },
    select: { id: true },
  });
  return row.id;
}

/**
 * Record a purge whose transaction did NOT commit.
 *
 * Written on the base client, deliberately: the transaction it describes was
 * rolled back, so a row written inside it would have vanished with it. Nothing
 * was deleted, so there is no off-DB work owed and the row is born terminal.
 */
export async function recordPurgeFailure(
  prisma: PrismaClient,
  targetDiscordId: string,
  runContext: string | null,
  reason: string
): Promise<void> {
  await prisma.retentionPurgeLog.create({
    data: {
      targetDiscordId,
      runContext,
      deletionCounts: { failureReason: reason },
      dbOutcome: 'failed',
      offDbReconciled: 'done',
      offDbPending: Prisma.DbNull,
    },
  });
}

/**
 * Settle a row's off-DB state. On success the pending payload is cleared, so
 * the ledger stops holding deleted characters' slugs once it no longer needs
 * them — an audit trail should record that a purge happened, not preserve the
 * content it erased.
 */
export async function settleOffDb(
  prisma: PrismaClient,
  logId: string,
  outcome: 'done' | 'failed'
): Promise<void> {
  await prisma.retentionPurgeLog.update({
    where: { id: logId },
    data: {
      offDbReconciled: outcome,
      ...(outcome === 'done' ? { offDbPending: Prisma.DbNull } : {}),
    },
  });
}

/** The shared retry-queue filter — every pending-off-DB read uses this shape. */
const PENDING_OFF_DB_WHERE = {
  dbOutcome: 'success',
  offDbReconciled: { not: 'done' },
} as const;

/**
 * Rows whose off-DB cleanup is still owed — the retry queue.
 *
 * Filtered to committed purges: a `failed` DB outcome never owed off-DB work,
 * so including it would make the sweep retry nothing forever. Unindexed on
 * purpose (the ledger gains one row per purged account — a seq scan over a
 * table measured in tens), but BOUNDED: a long-unreconciled backlog must not
 * run the whole queue inside one HTTP request against the platform's ~60s
 * timeout — the same lesson the purge itself learned per-user.
 */
export async function findPendingOffDbRows(
  prisma: PrismaClient,
  take: number
): Promise<PendingOffDbRow[]> {
  const rows = await prisma.retentionPurgeLog.findMany({
    where: PENDING_OFF_DB_WHERE,
    select: { id: true, targetDiscordId: true, offDbPending: true },
    orderBy: { purgedAt: 'asc' },
    take,
  });
  return rows.map(row => ({
    id: row.id,
    targetDiscordId: row.targetDiscordId,
    characterSlugs: extractSlugs(row.offDbPending),
  }));
}

/** Size of the retry queue — lets a bounded sweep report what it didn't reach. */
export async function countPendingOffDbRows(prisma: PrismaClient): Promise<number> {
  return prisma.retentionPurgeLog.count({ where: PENDING_OFF_DB_WHERE });
}

/**
 * Read `characterSlugs` out of the stored JSON defensively. The column is
 * `Json?`, so the type system cannot vouch for its shape — a row written by an
 * older revision (or hand-edited) must degrade to "nothing to retry" rather
 * than crash the sweep for every other row behind it.
 */
function extractSlugs(pending: Prisma.JsonValue | null): string[] {
  if (pending === null || typeof pending !== 'object' || Array.isArray(pending)) {
    return [];
  }
  const slugs = (pending as Record<string, unknown>).characterSlugs;
  if (!Array.isArray(slugs)) {
    return [];
  }
  return slugs.filter((slug): slug is string => typeof slug === 'string');
}
