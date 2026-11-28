/**
 * Which long-term memories a reroll removes: the old reply's, found without
 * touching them.
 *
 * A triggered reply's memory keys on the trigger message id, so the edit-sync
 * planner finds it (`planExchangeMemorySync`). A reply with no trigger (a
 * weigh-in) stores a memory with EMPTY `messageIds`; those are found by the
 * exact reply text inside the window a worker can store one.
 */

import { findImmediateTriggerRow } from '@tzurot/conversation-history';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
import {
  planExchangeMemorySync,
  type EditedReplyRow,
  type MemorySyncBlockReason,
} from './historyEditMemory.js';
import { pendingMessageIds, storedReply } from './historyEditMemoryPrimary.js';
import { type PlanExclusions } from './historyEditMemorySiblings.js';

const logger = createLogger('user-history-reroll-memory-plan');

/** Candidates read per table, after the reply-text prefilter; more than one exact match is ambiguous. */
const UNTRIGGERED_CANDIDATES = 3;

/**
 * How much of the reply's start identifies a chunk group of an untriggered
 * memory: chunk texts are slices of the whole exchange, so no chunk holds the
 * whole reply. Not verified: a chunk boundary inside the first characters of
 * the reply would hide the group (then the plan finds nothing to block).
 */
const CHUNK_PREFIX_LENGTH = 80;

/** What a reroll removes from memory, or why it must not proceed. */
export type RerollMemoryRemovalPlan =
  | { kind: 'none' }
  | { kind: 'remove'; memoryIds: string[]; pendingIds: string[] }
  | { kind: 'blocked'; reason: MemorySyncBlockReason };

/** Plan the removal of `row`'s memories, leaving `excluded` rows (the new reply's) alone. Read-only. */
export async function planRerollMemoryRemoval(
  prisma: PrismaClient,
  row: EditedReplyRow,
  excluded: PlanExclusions = {}
): Promise<RerollMemoryRemovalPlan> {
  const trigger = await findImmediateTriggerRow(prisma, {
    channelId: row.channelId,
    personalityId: row.personalityId,
    personaId: row.personaId,
    createdAt: row.createdAt,
  });
  if (trigger !== null) {
    const plan = await planExchangeMemorySync(prisma, row, undefined, {
      ...excluded,
      includeStaleOrphans: true,
    });
    return plan.kind === 'sync'
      ? { kind: 'remove', memoryIds: plan.memoryIds, pendingIds: plan.pendingIds }
      : plan;
  }
  return planUntriggered(prisma, row, excluded);
}

async function planUntriggered(
  prisma: PrismaClient,
  row: EditedReplyRow,
  excluded: PlanExclusions
): Promise<RerollMemoryRemovalPlan> {
  // An empty reply identifies nothing: `contains: ''` matches every untriggered
  // memory, so refuse rather than match them all.
  if (row.content.trim() === '') {
    logger.warn({ rowId: row.id }, 'Untriggered reroll of an empty reply; reroll blocked');
    return { kind: 'blocked', reason: 'ambiguous' };
  }
  // Open-ended on purpose: a committed reroll keeps the old row's createdAt
  // while its memory is stamped at store time, so the memory of a row rerolled
  // N times can sit arbitrarily far after `row.createdAt`. The reply-text
  // prefilter and the exact `storedReply` match below keep the read narrow.
  const window = { gte: row.createdAt, lte: new Date() };
  const excludedMemory = excluded.excludeMemoryIds ?? [];
  const excludedPending = excluded.excludePendingIds ?? [];

  const memoryCandidates = await prisma.memory.findMany({
    where: {
      personaId: row.personaId,
      personalityId: row.personalityId,
      visibility: 'normal',
      type: 'memory',
      isSummarized: false,
      messageIds: { isEmpty: true },
      createdAt: window,
      // A chunked memory never holds the whole reply: find its chunks by the
      // reply's start, and block on them below.
      OR: [
        { content: { contains: row.content } },
        {
          chunkGroupId: { not: null },
          content: { contains: row.content.slice(0, CHUNK_PREFIX_LENGTH) },
        },
      ],
      ...(excludedMemory.length > 0 && { id: { notIn: excludedMemory } }),
    },
    select: { id: true, content: true, isLocked: true, chunkGroupId: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: UNTRIGGERED_CANDIDATES,
  });
  const pendingCandidates = await prisma.pendingMemory.findMany({
    where: {
      personaId: row.personaId,
      personalityId: row.personalityId,
      createdAt: window,
      text: { contains: row.content },
      ...(excludedPending.length > 0 && { id: { notIn: excludedPending } }),
    },
    select: { id: true, text: true, metadata: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: UNTRIGGERED_CANDIDATES,
  });

  if (memoryCandidates.some(memory => memory.chunkGroupId !== null)) {
    return { kind: 'blocked', reason: 'chunked' };
  }
  const memories = memoryCandidates.filter(memory => storedReply(memory.content) === row.content);
  const pendings = pendingCandidates.filter(
    pending =>
      pendingMessageIds(pending.metadata).length === 0 && storedReply(pending.text) === row.content
  );

  if (memories.length > 1 || pendings.length > 1) {
    logger.warn(
      { rowId: row.id, memoryMatches: memories.length, pendingMatches: pendings.length },
      'Ambiguous untriggered memory match; reroll blocked'
    );
    return { kind: 'blocked', reason: 'ambiguous' };
  }
  const memory = memories.at(0);
  if (memory?.isLocked === true) {
    return { kind: 'blocked', reason: 'locked' };
  }
  if (memory !== undefined && memory.chunkGroupId !== null) {
    return { kind: 'blocked', reason: 'chunked' };
  }
  const memoryIds = memory === undefined ? [] : [memory.id];
  const pendingIds = pendings.map(pending => pending.id);
  return memoryIds.length === 0 && pendingIds.length === 0
    ? { kind: 'none' }
    : { kind: 'remove', memoryIds, pendingIds };
}
