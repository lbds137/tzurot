/**
 * The memory ids a reroll attempt wrote, read back from the generation job's
 * stored result (`job_results`) instead of trusted from the caller. The worker
 * writes the result before delivery, with `metadata.rerollMemory` carrying the
 * reroll's row and attempt ids beside the memory ids, so a caller can neither
 * name memories the attempt never wrote nor hide ones it did (the coalesced
 * reply's other-author memories among them).
 */

import type { Prisma } from '@tzurot/common-types/services/prisma';
import { rerollMemoryReportSchema } from '@tzurot/common-types/types/schemas/generation';
import { generateRerolledConversationHistoryUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { z } from 'zod';

const logger = createLogger('user-history-reroll-job-result');

const storedResultSchema = z.object({
  metadata: z.object({ rerollMemory: rerollMemoryReportSchema }),
});

/** At most this many abandoned attempts are swept per commit (a row is rerolled one at a time, so a handful at most). */
const SWEPT_ATTEMPTS_PER_COMMIT = 20;

/** Why a job result could not vouch for an attempt's ids. */
type Unusable = 'missing' | 'malformed' | 'mismatch';

export interface AttemptMemory {
  memoryIds: string[];
  pendingIds: string[];
}

export interface AttemptKey {
  jobId: string;
  rowId: string;
  attemptId: string;
}

/**
 * The attempt's memory and pending ids when the job's stored result belongs to
 * this row and attempt; null (with a warning naming the job and the reason)
 * when there is no result, it carries no reroll report, or it is another
 * attempt's. The caller then falls back to the ids the request carried.
 */
export async function readAttemptMemory(
  db: Pick<Prisma.TransactionClient, 'jobResult'>,
  key: AttemptKey
): Promise<AttemptMemory | null> {
  const stored = await db.jobResult.findUnique({
    where: { jobId: key.jobId },
    select: { result: true },
  });
  let reason: Unusable | null = null;
  let found: AttemptMemory | null = null;
  if (stored === null) {
    reason = 'missing';
  } else {
    const parsed = storedResultSchema.safeParse(stored.result);
    if (!parsed.success) {
      reason = 'malformed';
    } else if (
      parsed.data.metadata.rerollMemory.rowId !== key.rowId ||
      parsed.data.metadata.rerollMemory.attemptId !== key.attemptId
    ) {
      reason = 'mismatch';
    } else {
      const { memoryIds, pendingIds } = parsed.data.metadata.rerollMemory;
      found = { memoryIds, pendingIds };
    }
  }
  if (reason !== null) {
    logger.warn(
      { jobId: key.jobId, rowId: key.rowId, reason },
      'No usable job result for the reroll attempt; using the ids the caller sent'
    );
  }
  return found;
}

const sweptRowSchema = z.object({
  job_id: z.string(),
  result: z.unknown(),
});

/** The memory each OTHER attempt on a row listed, keyed by the successor row id its commit would create. */
export type SuccessorCandidates = Map<string, AttemptMemory>;

/**
 * Read the row's other job results (the 20 newest; nothing can start on the old
 * row once a commit landed, so the committer is among them) into the successor
 * row ids their commits would create. Reads `job_results` through an unindexed
 * JSON path, so a late abort calls it BEFORE it takes the row lock; the fields
 * it reads are immutable once written. `NULLS LAST` keeps a row without a
 * `completed_at` from sorting first.
 */
export async function readSuccessorCandidates(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  args: { rowId: string; attemptId: string }
): Promise<SuccessorCandidates> {
  const rows = await db.$queryRaw<unknown[]>`
    SELECT job_id, result FROM job_results
    WHERE result->'metadata'->'rerollMemory'->>'rowId' = ${args.rowId}
    ORDER BY completed_at DESC NULLS LAST
    LIMIT ${SWEPT_ATTEMPTS_PER_COMMIT}`;
  const byNewId: SuccessorCandidates = new Map();
  for (const raw of rows) {
    const parsed = storedResultSchema.safeParse(sweptRowSchema.parse(raw).result);
    if (!parsed.success) {
      continue;
    }
    const report = parsed.data.metadata.rerollMemory;
    if (report.attemptId !== args.attemptId) {
      byNewId.set(generateRerolledConversationHistoryUuid(args.rowId, report.attemptId), {
        memoryIds: report.memoryIds,
        pendingIds: report.pendingIds,
      });
    }
  }
  return byNewId;
}

/**
 * What the attempt that COMMITTED on this row wrote: of the candidates, the
 * attempt whose successor row (`generateRerolledConversationHistoryUuid(rowId,
 * attemptId)`, the id the commit gives the new row) is live. Empty when none
 * is. A late abort keeps these ids: memory ids are content-addressed, so two
 * attempts with the same reply text list the same id. Only this lookup runs
 * under the row lock.
 */
export async function liveSuccessorMemory(
  tx: Pick<Prisma.TransactionClient, 'conversationHistory'>,
  byNewId: SuccessorCandidates
): Promise<AttemptMemory> {
  if (byNewId.size === 0) {
    return { memoryIds: [], pendingIds: [] };
  }
  const live = await tx.conversationHistory.findMany({
    where: { id: { in: [...byNewId.keys()] }, deletedAt: null },
    select: { id: true },
    take: byNewId.size,
  });
  const owned: AttemptMemory = { memoryIds: [], pendingIds: [] };
  for (const { id } of live) {
    owned.memoryIds.push(...(byNewId.get(id)?.memoryIds ?? []));
    owned.pendingIds.push(...(byNewId.get(id)?.pendingIds ?? []));
  }
  return owned;
}

export interface SweepArgs {
  rowId: string;
  /** The committing job: its own result is never swept. */
  jobId: string;
  personalityId: string;
  /** Memories and pendings the committing attempt wrote; an identical reply dedupes onto an abandoned attempt's ids, so these are never removed. */
  keepMemoryIds: string[];
  keepPendingIds: string[];
}

/**
 * Remove what the row's other, abandoned reroll attempts wrote, found through
 * their stored job results, then mark those results DELIVERED so the cleanup
 * job removes them (the deletes and the DELIVERED marks share the caller's
 * transaction). Call it in its own short transaction after the commit landed.
 *
 * Any job result naming this row (other than the committing job) belongs to an
 * attempt that can no longer land: a committed attempt soft-deletes the row, so
 * nothing can commit on it again (`RowChangedError`), and a later reroll
 * targets the new row's id. So neither age nor status is filtered: a young
 * attempt still running is swept too (its later commit is refused and its abort
 * removes nothing extra), and a result already DELIVERED (a duplicate delivery,
 * an abort that answered `unknown`) can still hold memories. Idempotent:
 * removing an already-deleted memory is a no-op, so it may overlap the
 * triggered stale-orphan rule of the memory plan. Locked memories stay.
 *
 * @returns how many memories it removed
 */
export async function sweepAbandonedAttempts(
  tx: Prisma.TransactionClient,
  args: SweepArgs
): Promise<number> {
  const rows = await tx.$queryRaw<unknown[]>`
    SELECT job_id, result FROM job_results
    WHERE result->'metadata'->'rerollMemory'->>'rowId' = ${args.rowId}
      AND job_id <> ${args.jobId}    ORDER BY completed_at ASC
    LIMIT ${SWEPT_ATTEMPTS_PER_COMMIT}`;
  if (rows.length === 0) {
    return 0;
  }
  const keepMemory = new Set(args.keepMemoryIds);
  const keepPending = new Set(args.keepPendingIds);
  const memoryIds = new Set<string>();
  const pendingIds = new Set<string>();
  const jobIds: string[] = [];
  for (const raw of rows) {
    const row = sweptRowSchema.parse(raw);
    jobIds.push(row.job_id);
    const parsed = storedResultSchema.safeParse(row.result);
    if (!parsed.success) {
      continue;
    }
    parsed.data.metadata.rerollMemory.memoryIds
      .filter(id => !keepMemory.has(id))
      .forEach(id => memoryIds.add(id));
    parsed.data.metadata.rerollMemory.pendingIds
      .filter(id => !keepPending.has(id))
      .forEach(id => pendingIds.add(id));
  }
  const removed = await tx.memory.updateMany({
    where: { id: { in: [...memoryIds] }, personalityId: args.personalityId, isLocked: false },
    data: { visibility: 'deleted' },
  });
  await tx.pendingMemory.deleteMany({
    where: { id: { in: [...pendingIds] }, personalityId: args.personalityId },
  });
  await tx.jobResult.updateMany({
    where: { jobId: { in: jobIds } },
    data: { status: 'DELIVERED', deliveredAt: new Date() },
  });
  logger.info(
    { rowId: args.rowId, attempts: jobIds.length, removedMemories: removed.count },
    'Swept abandoned reroll attempts'
  );
  return removed.count;
}
