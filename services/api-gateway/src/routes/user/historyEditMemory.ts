/**
 * Keeps the long-term memory of one exchange in step with an edited assistant
 * reply.
 *
 * A memory keys on the TRIGGER (user) message id, not the reply's, and stores
 * `{user}: <message>\n{assistant}: <reply>`. So the memory for an edited reply
 * is found in two hops: the user row that triggered the reply, then the memory
 * whose `messageIds` contain that row's Discord id. A not-yet-stored exchange
 * lives in a `PendingMemory` row with the same text template and the same
 * trigger id in `metadata.messageIds`; the pending retry stores its text
 * verbatim, so that row must follow the edit too.
 *
 * Two steps: `planExchangeMemorySync` decides (read-only), and
 * `applyExchangeMemorySync` writes what the plan names. A blocked plan means the
 * edit must not happen, because memory would disagree with the history.
 */

import { findImmediateTriggerRow } from '@tzurot/conversation-history';
import { COALESCING, MessageRole } from '@tzurot/common-types/constants/message';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { rewriteReplyInExchangeText } from '@tzurot/common-types/utils/memoryReplyRewrite';
import { splitMemoryContent } from '@tzurot/common-types/utils/memoryContentSplit';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { writeMemoryContent } from './memorySingle.js';

const logger = createLogger('user-history-edit-memory');

/** The edited reply row, as selected by the edit route's lookup. */
export interface EditedReplyRow {
  id: string;
  /**
   * The reply text as stored BEFORE the edit. Sibling memories are matched on
   * it, so a re-plan after the history write must still carry the pre-edit text.
   */
  content: string;
  channelId: string;
  personaId: string;
  personalityId: string;
  createdAt: Date;
}

/**
 * `off-template`: the stored text does not parse. `reply-off-template`: it
 * parses as stored, but not with the new reply in it.
 */
export type MemorySyncBlockReason =
  'locked' | 'other-locked' | 'chunked' | 'ambiguous' | 'off-template' | 'reply-off-template';

/** Rows to rewrite, the edited user's own first. */
export type ExchangeMemoryPlan =
  | { kind: 'none' }
  | { kind: 'sync'; memoryIds: string[]; pendingIds: string[] }
  | { kind: 'blocked'; reason: MemorySyncBlockReason };

/** The block reason for a new reply that would make a stored text unparseable. */
const REPLY_OFF_TEMPLATE = 'reply-off-template' as const;

/**
 * Why `text` cannot follow an edit, or null when it can (to `newReply` when
 * given, else as stored).
 */
function templateBlock(
  text: string,
  newReply: string | undefined
): 'off-template' | 'reply-off-template' | null {
  if (splitMemoryContent(text) === null) {
    return 'off-template';
  }
  if (newReply !== undefined && rewriteReplyInExchangeText(text, newReply) === null) {
    return REPLY_OFF_TEMPLATE;
  }
  return null;
}

/** Rows read per sibling candidate; more than one match for a candidate is ambiguous. */
const SIBLING_ROWS_PER_CANDIDATE = 3;

/** Another user's trigger that the edited reply may have answered. */
interface SiblingCandidate {
  personaId: string;
  discordMessageId: string[];
}

interface SiblingPlan {
  blocked: MemorySyncBlockReason | null;
  memoryIds: string[];
  pendingIds: string[];
}

/** What the primary plan already covers; siblings must not count it again. */
interface PrimaryCoverage {
  triggerIds: string[];
  memoryId: string | undefined;
  pendingId: string | undefined;
}

function primaryCoverage(
  triggerIds: string[],
  memory: { id: string } | undefined,
  pending: { id: string } | undefined
): PrimaryCoverage {
  return { triggerIds, memoryId: memory?.id, pendingId: pending?.id };
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
async function findSiblingCandidates(
  prisma: PrismaClient,
  row: EditedReplyRow,
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

/** A sibling row that holds the pre-edit reply, with what stops it being rewritten. */
interface SiblingMatch {
  id: string;
  text: string;
  blocker: 'locked' | 'other-locked' | 'chunked' | null;
}

/** A locked memory of the editor's own persona is `locked`; anyone else's is `other-locked`. */
function memoryBlocker(
  memory: { personaId: string | null; isLocked: boolean; chunkGroupId: string | null },
  editorPersonaId: string
): SiblingMatch['blocker'] {
  if (memory.isLocked) {
    return memory.personaId === editorPersonaId ? 'locked' : 'other-locked';
  }
  return memory.chunkGroupId === null ? null : 'chunked';
}

/** The reply half of a stored exchange text, or null when it does not parse. */
function storedReply(text: string): string | null {
  return splitMemoryContent(text)?.assistant ?? null;
}

/** The `messageIds` a pending row's metadata carries (empty when absent or malformed). */
function pendingMessageIds(metadata: unknown): string[] {
  if (typeof metadata !== 'object' || metadata === null || !('messageIds' in metadata)) {
    return [];
  }
  const ids: unknown = metadata.messageIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

interface SiblingRows {
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

/** One batched read per table of the rows the candidates may own. */
async function loadSiblingRows(
  prisma: PrismaClient,
  personalityId: string,
  candidates: SiblingCandidate[],
  primary: PrimaryCoverage
): Promise<SiblingRows> {
  const take = candidates.length * SIBLING_ROWS_PER_CANDIDATE;
  const memories = await prisma.memory.findMany({
    where: {
      personalityId,
      visibility: 'normal',
      type: 'memory',
      isSummarized: false,
      // The primary plan already holds its own rows; one keyed on several
      // triggers must not come back as a sibling (and read as ambiguous).
      ...(primary.memoryId !== undefined && { id: { not: primary.memoryId } }),
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
      ...(primary.pendingId !== undefined && { id: { not: primary.pendingId } }),
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

/**
 * Plan the other memories of this reply (coalesced replies: other users', and
 * the editor's own earlier messages). A memory
 * or pending row is a sibling only when it belongs to a candidate's persona and
 * trigger AND holds exactly the pre-edit reply; one with a different reply is
 * another exchange and is ignored. One batched query per table, never one per
 * candidate.
 */
async function planSiblings(
  prisma: PrismaClient,
  row: EditedReplyRow,
  newReply: string | undefined,
  primary: PrimaryCoverage
): Promise<SiblingPlan> {
  const none: SiblingPlan = { blocked: null, memoryIds: [], pendingIds: [] };
  const candidates = await findSiblingCandidates(prisma, row, primary.triggerIds);
  if (candidates.length === 0) {
    return none;
  }
  const { memories, pendings } = await loadSiblingRows(
    prisma,
    row.personalityId,
    candidates,
    primary
  );

  const reasons = new Set<MemorySyncBlockReason>();
  const memoryIds = new Set<string>();
  const pendingIds = new Set<string>();
  const collect = (matches: SiblingMatch[], ids: Set<string>): void => {
    if (matches.length > 1) {
      reasons.add('ambiguous');
    }
    for (const match of matches) {
      ids.add(match.id);
      for (const reason of [match.blocker, templateBlock(match.text, newReply)]) {
        if (reason !== null) {
          reasons.add(reason);
        }
      }
    }
  };
  for (const candidate of candidates) {
    const owns = (personaId: string | null, ids: string[]): boolean =>
      personaId === candidate.personaId && ids.some(id => candidate.discordMessageId.includes(id));
    // Invariant: the history row's `content` equals the reply half of the memory
    // text, both written from the ai-worker's response content; the component
    // test "rewrites the other user memory and pending row" pins it. A row that
    // is the candidate's but holds a different reply is another exchange.
    const sameReply = (id: string, text: string): boolean => {
      const same = storedReply(text) === row.content;
      if (!same) {
        logger.debug(
          { rowId: row.id, candidatePersonaId: candidate.personaId, candidateRowId: id },
          'Sibling memory row holds a different reply; left alone'
        );
      }
      return same;
    };
    collect(
      memories
        .filter(
          memory =>
            owns(memory.personaId, memory.messageIds) && sameReply(memory.id, memory.content)
        )
        .map(memory => ({
          id: memory.id,
          text: memory.content,
          blocker: memoryBlocker(memory, row.personaId),
        })),
      memoryIds
    );
    collect(
      pendings
        .filter(
          pending =>
            owns(pending.personaId, pendingMessageIds(pending.metadata)) &&
            sameReply(pending.id, pending.text)
        )
        .map(pending => ({ id: pending.id, text: pending.text, blocker: null })),
      pendingIds
    );
  }

  // Same order as the primary: ambiguity, locks, chunking, then the reply itself.
  // (A matched sibling already parses as stored, so no stored `off-template`.)
  const order: MemorySyncBlockReason[] = [
    'ambiguous',
    'locked',
    'other-locked',
    'chunked',
    REPLY_OFF_TEMPLATE,
  ];
  return {
    blocked: order.find(reason => reasons.has(reason)) ?? null,
    memoryIds: [...memoryIds],
    pendingIds: [...pendingIds],
  };
}

/**
 * Decide how the exchange's memory follows an edit of `row`. Read-only.
 *
 * @param newReply when given, an edit that would make a stored text
 * unparseable is `off-template`; without it only the stored shape is checked.
 */
export async function planExchangeMemorySync(
  prisma: PrismaClient,
  row: EditedReplyRow,
  newReply?: string
): Promise<ExchangeMemoryPlan> {
  const { channelId, personalityId, personaId } = row;
  // personaId is scoped too: a shared channel can hold another persona's turn
  // just before this reply, and its memory is not this one.
  const trigger = await findImmediateTriggerRow(prisma, {
    channelId,
    personalityId,
    personaId,
    createdAt: row.createdAt,
  });

  if (trigger === null) {
    logger.debug({ rowId: row.id }, 'No trigger row for the edited reply; nothing to sync');
    return { kind: 'none' };
  }

  const memories = await prisma.memory.findMany({
    where: {
      messageIds: { hasSome: trigger.discordMessageId },
      personalityId,
      personaId,
      visibility: 'normal',
      type: 'memory',
      isSummarized: false,
    },
    select: { id: true, content: true, isLocked: true, chunkGroupId: true },
    take: 2,
  });

  const pendings = await prisma.pendingMemory.findMany({
    where: {
      personaId,
      personalityId,
      OR: trigger.discordMessageId.map(id => ({
        metadata: { path: ['messageIds'], array_contains: [id] },
      })),
    },
    select: { id: true, text: true },
    take: 2,
  });

  if (memories.length > 1 || pendings.length > 1) {
    logger.warn(
      { rowId: row.id, memoryMatches: memories.length, pendingMatches: pendings.length },
      'Ambiguous exchange memory match; edit blocked'
    );
    return { kind: 'blocked', reason: 'ambiguous' };
  }
  const memory = memories.at(0);
  const pending = pendings.at(0);

  if (memory?.isLocked === true) {
    return { kind: 'blocked', reason: 'locked' };
  }
  if (memory !== undefined && memory.chunkGroupId !== null) {
    return { kind: 'blocked', reason: 'chunked' };
  }
  const blocks = [
    memory === undefined ? null : templateBlock(memory.content, newReply),
    pending === undefined ? null : templateBlock(pending.text, newReply),
  ].filter(block => block !== null);
  // A stored text that is itself unparseable outranks a reply-specific refusal:
  // no reply could fix it.
  const reason = blocks.find(block => block !== REPLY_OFF_TEMPLATE) ?? blocks.at(0);
  if (reason !== undefined) {
    logger.warn(
      { rowId: row.id, memoryId: memory?.id, pendingId: pending?.id, reason },
      'Exchange memory cannot follow the edit; edit blocked'
    );
    return { kind: 'blocked', reason };
  }

  // The primary's reasons outrank the siblings': a block here is another
  // memory of the same coalesced reply (another user's, or the editor's own
  // earlier message).
  const siblings = await planSiblings(
    prisma,
    row,
    newReply,
    primaryCoverage(trigger.discordMessageId, memory, pending)
  );
  if (siblings.blocked !== null) {
    logger.warn(
      { rowId: row.id, reason: siblings.blocked },
      'A sibling exchange memory cannot follow the edit; edit blocked'
    );
    return { kind: 'blocked', reason: siblings.blocked };
  }

  const memoryIds = [...(memory === undefined ? [] : [memory.id]), ...siblings.memoryIds];
  const pendingIds = [...(pending === undefined ? [] : [pending.id]), ...siblings.pendingIds];
  if (memoryIds.length === 0 && pendingIds.length === 0) {
    return { kind: 'none' };
  }
  return { kind: 'sync', memoryIds, pendingIds };
}

/**
 * Write what a `sync` plan names. Each row is re-read by id so the rewrite
 * applies to its current text; a row that vanished or stopped matching the
 * template since planning is skipped with a warning.
 *
 * @returns whether every planned row was written; a skipped row is `false`.
 */
export async function applyExchangeMemorySync(
  prisma: PrismaClient,
  plan: Extract<ExchangeMemoryPlan, { kind: 'sync' }>,
  newReply: string
): Promise<boolean> {
  let allWritten = true;
  for (const memoryId of plan.memoryIds) {
    allWritten = (await applyMemory(prisma, memoryId, newReply)) && allWritten;
  }
  for (const pendingId of plan.pendingIds) {
    allWritten = (await applyPending(prisma, pendingId, newReply)) && allWritten;
  }
  return allWritten;
}

/** Rewrite one memory's reply; false when it vanished or stopped parsing. */
async function applyMemory(
  prisma: PrismaClient,
  memoryId: string,
  newReply: string
): Promise<boolean> {
  const memory = await prisma.memory.findUnique({
    where: { id: memoryId },
    select: { content: true },
  });
  const rewritten = memory === null ? null : rewriteReplyInExchangeText(memory.content, newReply);
  if (rewritten === null) {
    logger.warn({ memoryId }, 'Planned memory no longer rewritable; skipped');
    return false;
  }
  await writeMemoryContent(prisma, memoryId, rewritten);
  return true;
}

/** Rewrite one pending row's reply; false when it vanished or stopped parsing. */
async function applyPending(
  prisma: PrismaClient,
  pendingId: string,
  newReply: string
): Promise<boolean> {
  const pending = await prisma.pendingMemory.findUnique({
    where: { id: pendingId },
    select: { text: true },
  });
  const rewritten = pending === null ? null : rewriteReplyInExchangeText(pending.text, newReply);
  if (rewritten !== null) {
    // updateMany: the row can be consumed between the read above and this write,
    // and a vanished row must be a warned skip, not a thrown not-found.
    const { count } = await prisma.pendingMemory.updateMany({
      where: { id: pendingId },
      data: { text: rewritten },
    });
    if (count > 0) {
      return true;
    }
  }
  logger.warn({ pendingId }, 'Planned pending memory gone or unrewritable');
  return false;
}
