/**
 * Sibling lookup for the exchange-memory plan: the other memories of one
 * coalesced reply.
 *
 * A coalesced reply answers several trigger messages (other users', and the
 * replier's own earlier ones), each with its own memory and pending row. This
 * module finds the candidate triggers and loads the rows they may own; the
 * planner (`historyEditMemory.ts`) decides which of them follow the edit.
 */

import { COALESCING, MessageRole } from '@tzurot/common-types/constants/message';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';

/** Rows read per sibling candidate; more than one match for a candidate is ambiguous. */
export const SIBLING_ROWS_PER_CANDIDATE = 3;

/** The part of a reply row the candidate search anchors on. */
export interface SiblingAnchorRow {
  channelId: string;
  personalityId: string;
  createdAt: Date;
}

/**
 * A trigger (user) row the coalesced reply may have answered: the same user's
 * earlier message or another user's.
 */
export interface SiblingCandidate {
  personaId: string;
  discordMessageId: string[];
}

/** What the primary plan already covers; siblings must not count it again. */
export interface PrimaryCoverage {
  triggerIds: string[];
  memoryId: string | undefined;
  pendingId: string | undefined;
}

/** Rows a caller wants left out of every plan query (a reroll's new rows). */
export interface PlanExclusions {
  excludeMemoryIds?: string[];
  excludePendingIds?: string[];
}

/**
 * The `id` filter that leaves out `own` (a row the primary plan holds) and the
 * caller's excluded ids; undefined when there is nothing to leave out.
 */
export function idExclusion(
  own: string | undefined,
  excluded: string[] | undefined
): { not: string } | { notIn: string[] } | undefined {
  const extra = excluded ?? [];
  if (extra.length === 0) {
    return own === undefined ? undefined : { not: own };
  }
  return { notIn: own === undefined ? extra : [...extra, own] };
}

/**
 * Trigger rows a coalesced reply may have answered besides the primary one:
 * user rows of this channel and personality (any persona, the editor's own
 * earlier messages included), after the personality's previous reply (or, with
 * none, within the coalescing hold deadline) and before this one. The primary
 * trigger is excluded in the query (`NOT`), so `take` bounds real candidates.
 * Soft-deleted rows are kept: a deleted message's memory can still be live
 * (see `findImmediateTriggerRow`), and the exact-reply match still guards.
 */
export async function findSiblingCandidates(
  prisma: PrismaClient,
  row: SiblingAnchorRow,
  primaryTriggerIds: string[]
): Promise<SiblingCandidate[]> {
  const { channelId, personalityId } = row;
  const previousReply = await prisma.conversationHistory.findFirst({
    where: {
      channelId,
      personalityId,
      role: MessageRole.Assistant,
      createdAt: { lt: row.createdAt },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { createdAt: true },
  });
  const after =
    previousReply?.createdAt ?? new Date(row.createdAt.getTime() - COALESCING.HOLD_DEADLINE_MS);

  const triggers = await prisma.conversationHistory.findMany({
    where: {
      channelId,
      personalityId,
      role: MessageRole.User,
      createdAt: { lt: row.createdAt, gt: after },
      ...(primaryTriggerIds.length > 0 && {
        NOT: { discordMessageId: { hasSome: primaryTriggerIds } },
      }),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { personaId: true, discordMessageId: true },
    take: COALESCING.MAX_SKIPPED_MESSAGES,
  });
  return triggers.filter(trigger => trigger.discordMessageId.length > 0);
}

/** Why a sibling row cannot be rewritten (or removed), or null when it can. */
export type SiblingBlocker = 'locked' | 'other-locked' | 'chunked' | null;

/**
 * A locked memory of the turn's own persona is `locked`; anyone else's is
 * `other-locked`.
 */
export function memoryBlocker(
  memory: { personaId: string | null; isLocked: boolean; chunkGroupId: string | null },
  turnPersonaId: string
): SiblingBlocker {
  if (memory.isLocked) {
    return memory.personaId === turnPersonaId ? 'locked' : 'other-locked';
  }
  return memory.chunkGroupId === null ? null : 'chunked';
}

export interface SiblingRows {
  memories: {
    id: string;
    personaId: string | null;
    messageIds: string[];
    content: string;
    isLocked: boolean;
    chunkGroupId: string | null;
  }[];
  pendings: { id: string; personaId: string | null; text: string; metadata: unknown }[];
}

/**
 * One batched read per table of the rows the candidates may own. `replyText`
 * narrows the read to rows whose text contains it (the planner still matches
 * the reply exactly), so `take` cannot cut the real row off behind rows of
 * other exchanges.
 */
export async function loadSiblingRows(
  prisma: PrismaClient,
  personalityId: string,
  candidates: SiblingCandidate[],
  primary: PrimaryCoverage,
  options: PlanExclusions & { replyText?: string } = {}
): Promise<SiblingRows> {
  const { replyText, ...exclusions } = options;
  const take = candidates.length * SIBLING_ROWS_PER_CANDIDATE;
  // The primary plan already holds its own rows; one keyed on several
  // triggers must not come back as a sibling (and read as ambiguous).
  const memoryId = idExclusion(primary.memoryId, exclusions.excludeMemoryIds);
  const pendingId = idExclusion(primary.pendingId, exclusions.excludePendingIds);
  const memories = await prisma.memory.findMany({
    where: {
      personalityId,
      visibility: 'normal',
      type: 'memory',
      isSummarized: false,
      ...(memoryId !== undefined && { id: memoryId }),
      ...(replyText !== undefined && { content: { contains: replyText } }),
      OR: candidates.map(candidate => ({
        personaId: candidate.personaId,
        messageIds: { hasSome: candidate.discordMessageId },
      })),
    },
    select: {
      id: true,
      personaId: true,
      messageIds: true,
      content: true,
      isLocked: true,
      chunkGroupId: true,
    },
    take,
  });
  const pendings = await prisma.pendingMemory.findMany({
    where: {
      personalityId,
      ...(pendingId !== undefined && { id: pendingId }),
      ...(replyText !== undefined && { text: { contains: replyText } }),
      OR: candidates.flatMap(candidate =>
        candidate.discordMessageId.map(id => ({
          personaId: candidate.personaId,
          metadata: { path: ['messageIds'], array_contains: [id] },
        }))
      ),
    },
    select: { id: true, personaId: true, text: true, metadata: true },
    take,
  });
  return { memories, pendings };
}
