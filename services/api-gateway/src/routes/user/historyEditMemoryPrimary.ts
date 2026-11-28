/**
 * The memory and pending rows keyed to an exchange's trigger message, and the
 * choice of which of them belong to the reply being edited or rerolled.
 *
 * Several rows can share one trigger id: a reroll whose bot-side cleanup never
 * ran leaves the abandoned attempt's memory beside the real one. The reply's
 * own memory is the one whose stored reply text equals the row's content. A
 * row with another text is an orphan: older than the job lifetime it can no
 * longer belong to a reroll in flight (a stale orphan); younger it might, so it
 * is left out of every plan.
 */

import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { splitMemoryContent } from '@tzurot/common-types/utils/memoryContentSplit';
import { idExclusion, type PlanExclusions } from './historyEditMemorySiblings.js';

/**
 * How long after a reply row's `createdAt` an untriggered memory of it can
 * still appear: the bot tracks a job for at most 40 minutes
 * (`TRACKED_JOB_MAX_LIFETIME_MS` in bot-client's `JobTracker`), so the worker
 * cannot store a memory for the reply later than that. Also the age past
 * which a same-trigger memory with another reply text can no longer belong to
 * a reroll in flight.
 */
export const UNTRIGGERED_MEMORY_WINDOW_MS = 40 * 60 * 1000;

/** Rows read per table for one trigger; bounded, since orphans can pile up. */
const PRIMARY_ROWS_TAKE = 10;

/** The reply half of a stored exchange text, or null when it does not parse. */
export function storedReply(text: string): string | null {
  return splitMemoryContent(text)?.assistant ?? null;
}

/** The `messageIds` a pending row's metadata carries (empty when absent or malformed). */
export function pendingMessageIds(metadata: unknown): string[] {
  if (typeof metadata !== 'object' || metadata === null || !('messageIds' in metadata)) {
    return [];
  }
  const ids: unknown = metadata.messageIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

export interface PrimaryMemoryRow {
  id: string;
  content: string;
  isLocked: boolean;
  chunkGroupId: string | null;
}

export interface PrimaryPendingRow {
  id: string;
  text: string;
}

export interface PrimaryRows {
  /** The reply's own rows; more than one means the match is ambiguous. */
  memories: PrimaryMemoryRow[];
  pendings: PrimaryPendingRow[];
  /** Stale orphans a reroll may remove (unlocked, unchunked memories; pending rows). */
  orphanMemoryIds: string[];
  orphanPendingIds: string[];
  /**
   * Why no plan may proceed on these rows, or null. A chunk-group row under
   * the trigger blocks (`chunked`: chunk groups are not reassembled); several
   * rows with no exact reply match, or a full page of rows, are `ambiguous`
   * (`locked` when one of them is locked). Never lets a chunked or locked
   * memory pass silently.
   */
  blocked: PrimaryBlockReason | null;
}

export type PrimaryBlockReason = 'ambiguous' | 'chunked' | 'locked';

interface Candidate {
  text: string;
  createdAt: Date;
  isLocked?: boolean;
  chunkGroupId?: string | null;
}

/**
 * Split rows sharing a trigger into the reply's own and the stale orphans. A
 * lone row is the reply's own whatever its text; with several, only exact
 * reply-text matches are, and the others are orphans when older than the job
 * lifetime and ignored when younger. Several rows that cannot be told apart
 * (see `PrimaryRows.blocked`) come back with a block instead.
 */
function classify<T extends Candidate>(
  rows: T[],
  replyText: string,
  now: number
): { own: T[]; stale: T[]; blocked: PrimaryBlockReason | null } {
  if (rows.length <= 1) {
    return { own: rows, stale: [], blocked: null };
  }
  const own = rows.filter(row => storedReply(row.text) === replyText);
  const stale = rows.filter(
    row =>
      storedReply(row.text) !== replyText &&
      now - row.createdAt.getTime() > UNTRIGGERED_MEMORY_WINDOW_MS
  );
  return { own, stale, blocked: blockReason(rows, own.length) };
}

function blockReason<T extends Candidate>(rows: T[], ownCount: number): PrimaryBlockReason | null {
  if (rows.some(row => (row.chunkGroupId ?? null) !== null)) {
    return 'chunked';
  }
  // A full page may hide the reply's own row behind the cap: do not guess.
  if (rows.length >= PRIMARY_ROWS_TAKE) {
    return 'ambiguous';
  }
  if (ownCount > 0) {
    return null;
  }
  return rows.some(row => row.isLocked === true) ? 'locked' : 'ambiguous';
}

/**
 * The memory and pending rows keyed to the trigger's Discord ids, scoped to
 * the row's persona and personality, classified against the row's reply text.
 */
export async function findPrimaryRows(
  prisma: PrismaClient,
  row: { personaId: string; personalityId: string; content: string },
  triggerIds: string[],
  options: PlanExclusions
): Promise<PrimaryRows> {
  const { personalityId, personaId } = row;
  const excludedMemory = idExclusion(undefined, options.excludeMemoryIds);
  const excludedPending = idExclusion(undefined, options.excludePendingIds);
  const memoryRows = await prisma.memory.findMany({
    where: {
      messageIds: { hasSome: triggerIds },
      personalityId,
      personaId,
      visibility: 'normal',
      type: 'memory',
      isSummarized: false,
      ...(excludedMemory !== undefined && { id: excludedMemory }),
    },
    select: { id: true, content: true, isLocked: true, chunkGroupId: true, createdAt: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: PRIMARY_ROWS_TAKE,
  });
  const pendingRows = await prisma.pendingMemory.findMany({
    where: {
      personaId,
      personalityId,
      ...(excludedPending !== undefined && { id: excludedPending }),
      OR: triggerIds.map(id => ({
        metadata: { path: ['messageIds'], array_contains: [id] },
      })),
    },
    select: { id: true, text: true, createdAt: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: PRIMARY_ROWS_TAKE,
  });

  const now = Date.now();
  const memories = classify(
    memoryRows.map(memory => ({ ...memory, text: memory.content })),
    row.content,
    now
  );
  const pendings = classify(pendingRows, row.content, now);
  return {
    blocked: memories.blocked ?? pendings.blocked,
    memories: memories.own.map(({ id, content, isLocked, chunkGroupId }) => ({
      id,
      content,
      isLocked,
      chunkGroupId,
    })),
    pendings: pendings.own.map(({ id, text }) => ({ id, text })),
    orphanMemoryIds: memories.stale
      .filter(memory => !memory.isLocked && memory.chunkGroupId === null)
      .map(memory => memory.id),
    orphanPendingIds: pendings.stale.map(pending => pending.id),
  };
}
