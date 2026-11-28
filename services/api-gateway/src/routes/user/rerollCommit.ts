/**
 * The reroll commit transaction: one transaction replaces the old row with the
 * new reply and removes the old reply's memories. It rolls back (by throwing
 * one of the errors below) rather than leave a half-replaced row. The row's
 * abandoned attempts are swept afterwards, in a transaction of their own.
 */

import { MessageRole } from '@tzurot/common-types/constants/message';
import type { RerollAssistantMessageRequestSchema } from '@tzurot/common-types/schemas/api/history';
import { type IncognitoKind } from '@tzurot/common-types/types/schemas/message';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { countTextTokens } from '@tzurot/common-types/utils/tokenCounter';
import { propagateDeletionToFacts } from '@tzurot/conversation-history';
import type { RouteDeps } from '../routeDeps.js';
import {
  REROLL_TRANSACTION_OPTIONS,
  committedRowMetadata,
  isTombstoned,
  lockHistoryRow,
} from './rerollAttempt.js';
import { sweepAbandonedAttempts } from './rerollJobResult.js';

const logger = createLogger('user-history-reroll-commit');

/** Thrown inside the commit transaction to roll it back when the old row was already replaced. */
export class RowChangedError extends Error {}

/** Thrown inside the commit transaction when a planned memory could not be removed (locked since planning). */
export class MemoryBlockedError extends Error {}

/** Thrown inside the commit transaction when an abort already tombstoned this attempt. */
export class AttemptAbortedError extends Error {}

export type RerollBody = ReturnType<typeof RerollAssistantMessageRequestSchema.parse>;

export interface CommitArgs {
  prisma: RouteDeps['prisma'];
  /** The old row, as re-read by the route. */
  row: {
    id: string;
    channelId: string;
    guildId: string | null;
    personalityId: string;
    personaId: string;
    createdAt: Date;
  };
  body: RerollBody;
  newId: string;
  incognito: boolean;
  incognitoKind: IncognitoKind | undefined;
  memoryIds: string[];
  pendingIds: string[];
  /** What the committing attempt wrote (its job result's lists, else the body's). */
  attemptMemoryIds: string[];
  attemptPendingIds: string[];
  /**
   * Set when the attempt's ids came from the request body (its job result
   * could not vouch): the revive is then limited to this owner's personas, so
   * a body cannot resurrect another user's deleted memory. Null when vouched.
   */
  reviveOwnerId: string | null;
}

/**
 * The commit transaction: replace the row and remove the planned memories.
 * Rolls back (throwing) when the old row was already replaced or a planned
 * memory could not be removed. Returns how many of the old reply's memories it
 * removed; the abandoned-attempt sweep is a separate step (`sweepAfterCommit`)
 * the route runs once it has answered.
 */
export async function commitReroll(args: CommitArgs): Promise<number> {
  const { prisma, row, body, newId, incognito, incognitoKind, memoryIds, pendingIds } = args;
  const thinking = body.thinkingContent ?? null;
  const now = new Date();
  return prisma.$transaction(async tx => {
    // The lock serializes this commit against an abort of the same row; the
    // tombstone read below is only meaningful under it.
    await lockHistoryRow(tx, row.id);
    const current = await tx.conversationHistory.findUnique({
      where: { id: row.id },
      select: { messageMetadata: true },
    });
    if (isTombstoned(current?.messageMetadata, body.attemptId)) {
      throw new AttemptAbortedError();
    }
    // Conditional on the row still being live: a concurrent commit that got
    // here first leaves count 0 and this transaction rolls back.
    const softDeleted = await tx.conversationHistory.updateMany({
      where: { id: row.id, deletedAt: null },
      data: { deletedAt: now },
    });
    if (softDeleted.count !== 1) {
      throw new RowChangedError();
    }
    await tx.conversationHistory.create({
      data: {
        id: newId,
        channelId: row.channelId,
        guildId: row.guildId,
        personalityId: row.personalityId,
        personaId: row.personaId,
        role: MessageRole.Assistant,
        content: body.content,
        tokenCount: countTextTokens(body.content),
        discordMessageId: body.discordMessageIds,
        // The new reply takes the old one's place in the timeline.
        createdAt: row.createdAt,
        thinkingContent: thinking === '' ? null : thinking,
        messageMetadata: committedRowMetadata(current?.messageMetadata, incognito, incognitoKind),
      },
    });
    // The committing attempt's own memories are live. The worker reports an id
    // even when its insert was a no-op (the id hashes the exchange text), so a
    // memory an earlier aborted or swept attempt left `deleted` is revived here.
    // Before the removal below, so an id in both sets stays removed.
    if (args.attemptMemoryIds.length > 0) {
      await tx.memory.updateMany({
        where: {
          id: { in: args.attemptMemoryIds },
          personalityId: row.personalityId,
          ...(args.reviveOwnerId === null ? {} : { persona: { ownerId: args.reviveOwnerId } }),
          isLocked: false,
          visibility: 'deleted',
        },
        data: { visibility: 'normal' },
      });
    }
    // The ids come from the server-side plan, not the body, and include other
    // personas' sibling memories of a coalesced reply, so no persona filter:
    // the personality scope and the lock exclusion still apply.
    const marked = await tx.memory.updateMany({
      where: {
        id: { in: memoryIds },
        personalityId: row.personalityId,
        isLocked: false,
      },
      data: { visibility: 'deleted' },
    });
    // A memory locked after planning is left behind: refuse rather than
    // replace the row while it keeps the old reply.
    if (marked.count !== memoryIds.length) {
      throw new MemoryBlockedError();
    }
    await tx.pendingMemory.deleteMany({
      where: {
        id: { in: pendingIds },
        personalityId: row.personalityId,
      },
    });
    return marked.count;
  }, REROLL_TRANSACTION_OPTIONS);
}

/**
 * Sweep the row's abandoned attempts, then propagate the memory deletions to
 * facts, after the commit landed and its response was sent. The sweep runs in
 * a short transaction of its own (it scans `job_results`, unindexed, so it
 * stays out of the row-locked commit). Never throws: a failure is logged at
 * warn with ids only, and the commit stands.
 *
 * A failed sweep is NOT retried. It filters on the old row's id, and the next
 * commit targets the successor row, so no later commit repeats it; what it
 * missed is left to the memory plan's stale-orphan rule (a triggered case only).
 *
 * No age filter: once the commit landed, no other attempt on the old row can
 * commit (`RowChangedError` above), so an attempt still running has nothing to
 * protect. Its own later commit is refused, and its abort removes nothing the
 * committed reply keeps (`liveSuccessorMemory`).
 */
export async function sweepAfterCommit(args: CommitArgs): Promise<void> {
  const { prisma, row, body } = args;
  try {
    const swept = await prisma.$transaction(
      tx =>
        sweepAbandonedAttempts(tx, {
          rowId: row.id,
          jobId: body.jobId,
          personalityId: row.personalityId,
          keepMemoryIds: args.attemptMemoryIds,
          keepPendingIds: args.attemptPendingIds,
        }),
      REROLL_TRANSACTION_OPTIONS
    );
    if (swept > 0) {
      await propagateDeletionToFacts(prisma);
    }
  } catch (error) {
    logger.warn(
      { rowId: row.id, jobId: body.jobId, err: error },
      'Abandoned-attempt sweep after a reroll commit failed; the commit stands and the sweep is not retried'
    );
  }
}
