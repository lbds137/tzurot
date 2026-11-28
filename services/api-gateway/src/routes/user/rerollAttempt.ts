/**
 * What the reroll routes share about one attempt: the history row's metadata
 * (incognito flag and kind, abort tombstones), the row lock that serializes a
 * commit against an abort, and the abort transaction itself.
 *
 * Commit and abort each lock the OLD row (`SELECT … FOR UPDATE`) before they
 * decide anything. Whichever gets the lock first wins: a commit that lands
 * first makes the abort report `committed` and remove nothing; an abort that
 * lands first leaves a tombstone (the attempt id in the old row's
 * `messageMetadata.abortedRerollAttempts`) that the commit refuses on. The
 * tombstone, not memory existence, is the signal: an incognito attempt has no
 * memories to look for.
 */

import type { Prisma } from '@tzurot/common-types/services/prisma';
import { MessageRole } from '@tzurot/common-types/constants/message';
import {
  ABORTED_REROLL_ATTEMPTS_KEPT,
  incognitoKindSchema,
  type IncognitoKind,
} from '@tzurot/common-types/types/schemas/message';
import { generateRerolledConversationHistoryUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { mergeMessageMetadata, propagateDeletionToFacts } from '@tzurot/conversation-history';
import type { RouteDeps } from '../routeDeps.js';
import { resolveMainLockTimeoutMs } from '@tzurot/common-types/services/poolConfig';
import { sha256Hex } from '@tzurot/common-types/utils/sha256Hex';
import {
  liveSuccessorMemory,
  readAttemptMemory,
  readSuccessorCandidates,
} from './rerollJobResult.js';

const TOMBSTONE_KEY = 'abortedRerollAttempts';

/** A row's `messageMetadata` as a plain object (empty when absent or not an object). */
export function metadataRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

export function storedIncognito(row: { messageMetadata: unknown }): boolean {
  return metadataRecord(row.messageMetadata).incognito === true;
}

/** The stored anonymity kind, or undefined for a legacy row or an unrecognised value. */
export function storedIncognitoKind(row: { messageMetadata: unknown }): IncognitoKind | undefined {
  const parsed = incognitoKindSchema.safeParse(metadataRecord(row.messageMetadata).incognitoKind);
  return parsed.success ? parsed.data : undefined;
}

/**
 * The new row's metadata: the old row's keys (minus its abort tombstones, which
 * name attempts against THAT row) with an explicit `incognito` boolean, so a
 * non-incognito reply never reads back as a legacy row. The kind is written only
 * for an incognito reply.
 */
export function committedRowMetadata(
  oldMetadata: unknown,
  incognito: boolean,
  kind: IncognitoKind | undefined
): Prisma.InputJsonObject {
  const {
    [TOMBSTONE_KEY]: _tombstones,
    incognitoKind: _oldKind,
    ...kept
  } = metadataRecord(oldMetadata);
  return {
    ...kept,
    incognito,
    ...(incognito && kind !== undefined ? { incognitoKind: kind } : {}),
  };
}

function tombstones(metadata: unknown): string[] {
  const list = metadataRecord(metadata)[TOMBSTONE_KEY];
  return Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : [];
}

export function isTombstoned(metadata: unknown, attemptId: string): boolean {
  return tombstones(metadata).includes(attemptId);
}

/** The tombstone list with `attemptId` appended (newest last, bounded). */
export function nextTombstones(metadata: unknown, attemptId: string): string[] {
  const known = tombstones(metadata);
  const next = known.includes(attemptId) ? known : [...known, attemptId];
  return next.slice(-ABORTED_REROLL_ATTEMPTS_KEPT);
}

type Tx = Prisma.TransactionClient;

/** Lock the history row for the rest of the transaction; commit and abort queue behind each other here. */
export async function lockHistoryRow(tx: Tx, rowId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM conversation_history WHERE id = ${rowId}::uuid FOR UPDATE`;
}

/** The new row id when this attempt's commit already landed (its deterministic row is live), else null. */
export async function findCommittedAttempt(
  db: Pick<Tx, 'conversationHistory'>,
  rowId: string,
  attemptId: string,
  ownerScope: Prisma.ConversationHistoryWhereInput
): Promise<string | null> {
  const newId = generateRerolledConversationHistoryUuid(rowId, attemptId);
  const landed = await db.conversationHistory.findFirst({
    where: { id: newId, role: MessageRole.Assistant, deletedAt: null, ...ownerScope },
    select: { id: true },
  });
  return landed === null ? null : newId;
}

/**
 * The `$transaction` options the reroll transactions share, derived from the
 * RESOLVED main-pool server `lock_timeout` (`DB_MAIN_LOCK_TIMEOUT_MS` when set,
 * else the default; `resolveMainLockTimeoutMs` is what the pool itself reads):
 *
 * - `timeout` is five times it, so a waiter on the row lock hits its 55P03
 *   inside the transaction's budget and fails by that name, not by Prisma's 5 s
 *   default expiring first, however the lock timeout is tuned.
 * - `maxWait` (how long the transaction may wait to start; per Prisma's docs a
 *   wait for a pooled connection, not probed here) is one lock timeout: the same
 *   patience a row-lock wait gets, and set explicitly so Prisma's 2 s default
 *   (`transactionOptions` in the generated client) does not sit under a raised
 *   lock timeout and fail a reroll first.
 */
const PRISMA_DEFAULT_TRANSACTION_TIMEOUT_MS = 5000;
const PRISMA_DEFAULT_TRANSACTION_MAX_WAIT_MS = 2000;

export function rerollTransactionOptions(env: NodeJS.ProcessEnv = process.env): {
  timeout: number;
  maxWait: number;
} {
  const lockTimeoutMs = resolveMainLockTimeoutMs(env);
  // Never below Prisma's own defaults: a small lock timeout must not shrink the
  // transaction budget or the connection wait under what an ordinary commit needs.
  return {
    timeout: Math.max(PRISMA_DEFAULT_TRANSACTION_TIMEOUT_MS, lockTimeoutMs * 5),
    maxWait: Math.max(PRISMA_DEFAULT_TRANSACTION_MAX_WAIT_MS, lockTimeoutMs),
  };
}

/** The `$transaction` options the reroll transactions share, resolved once at load like the pool. */
export const REROLL_TRANSACTION_OPTIONS = rerollTransactionOptions();

/** Interactive-transaction timeout for the reroll commit and abort (see `rerollTransactionOptions`). */
export const REROLL_TRANSACTION_TIMEOUT_MS = REROLL_TRANSACTION_OPTIONS.timeout;

export interface AbortOutcome {
  committed: boolean;
  removedMemories: number;
  oldRowLive: boolean;
  oldRowContentDigest: string | null;
}

export interface AbortArgs {
  prisma: RouteDeps['prisma'];
  rowId: string;
  attemptId: string;
  /** The generation job whose stored result lists the attempt's memories. */
  jobId: string;
  ownerScope: Prisma.ConversationHistoryWhereInput;
  /** The old row's persona, personality and the persona's owner (the requesting user). */
  row: { personaId: string; personalityId: string; ownerId: string };
  newMemoryIds: string[];
  newPendingIds: string[];
  keepMemoryIds: string[];
}

/**
 * Abort an attempt under the row lock. When the commit already landed nothing is
 * removed. Otherwise the attempt is tombstoned and its memories removed:
 * exactly the reported ids outside the keep set, constrained to the requesting
 * user and personality (a sibling persona's memory the worker wrote for a
 * coalesced reply is cleaned too), unlocked only.
 *
 * The row's other job results are read BEFORE the lock (an unindexed JSON-path
 * scan whose fields never change once written; a commit waiting on this lock
 * would otherwise sit behind it). Only the lookup of which successor row is
 * live runs under the lock. The read happens on every abort, though only a
 * late one uses it, because the lock is what says whether the abort is late.
 */
export async function abortRerollAttempt(args: AbortArgs): Promise<AbortOutcome> {
  const { prisma, rowId, attemptId, ownerScope, row } = args;
  const successorCandidates = await readSuccessorCandidates(prisma, { rowId, attemptId });
  const result = await prisma.$transaction(async tx => {
    await lockHistoryRow(tx, rowId);
    if ((await findCommittedAttempt(tx, rowId, attemptId, ownerScope)) !== null) {
      // The commit soft-deleted the old row.
      return { committed: true, removedMemories: 0, oldRowLive: false, oldRowContentDigest: null };
    }
    const current = await tx.conversationHistory.findUnique({
      where: { id: rowId },
      select: { messageMetadata: true, content: true, deletedAt: true },
    });
    const oldRowLive = current !== null && current.deletedAt === null;
    // Merged server-side (the only sanctioned write of an existing row's
    // metadata); the row lock held here keeps the list read above current.
    const tombstoned = await mergeMessageMetadata(
      tx,
      rowId,
      { abortedRerollAttempts: nextTombstones(current?.messageMetadata, attemptId) },
      { operation: 'reroll-abort-tombstone' }
    );
    if (tombstoned !== 'updated') {
      throw new Error('Reroll abort could not record its tombstone');
    }
    const keep = new Set(args.keepMemoryIds);
    const keepPending = new Set<string>();
    if (!oldRowLive) {
      // A late abort: the row was replaced by another attempt's commit. Ids are
      // content-addressed, so this attempt may list a memory that attempt owns.
      const owned = await liveSuccessorMemory(tx, successorCandidates);
      owned.memoryIds.forEach(id => keep.add(id));
      owned.pendingIds.forEach(id => keepPending.add(id));
    }
    const recorded = await readAttemptMemory(tx, { jobId: args.jobId, rowId, attemptId });
    // A matching job result names every memory the attempt wrote, whatever
    // persona (a coalesced reply writes other users' memories), so only the
    // personality and the lock bound the delete. Without one, the caller's ids
    // are limited to the requesting user's personas.
    const memoryIds = (recorded?.memoryIds ?? args.newMemoryIds).filter(id => !keep.has(id));
    const pendingIds = (recorded?.pendingIds ?? args.newPendingIds).filter(
      id => !keepPending.has(id)
    );
    const removed = await tx.memory.updateMany({
      where: {
        id: { in: memoryIds },
        personalityId: row.personalityId,
        ...(recorded === null ? { persona: { ownerId: row.ownerId } } : {}),
        isLocked: false,
      },
      data: { visibility: 'deleted' },
    });
    await tx.pendingMemory.deleteMany({
      where: {
        id: { in: pendingIds },
        ...(recorded === null ? { personaId: row.personaId } : {}),
        personalityId: row.personalityId,
      },
    });
    return {
      committed: false,
      removedMemories: removed.count,
      oldRowLive,
      oldRowContentDigest: oldRowLive && current !== null ? sha256Hex(current.content) : null,
    };
  }, REROLL_TRANSACTION_OPTIONS);
  if (result.removedMemories > 0) {
    await propagateDeletionToFacts(prisma);
  }
  return result;
}
