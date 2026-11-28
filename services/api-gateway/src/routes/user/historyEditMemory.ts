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
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { rewriteReplyInExchangeText } from '@tzurot/common-types/utils/memoryReplyRewrite';
import { splitMemoryContent } from '@tzurot/common-types/utils/memoryContentSplit';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { writeMemoryContent } from './memorySingle.js';

const logger = createLogger('user-history-edit-memory');

/** The edited reply row, as selected by the edit route's lookup. */
export interface EditedReplyRow {
  id: string;
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
  'locked' | 'chunked' | 'ambiguous' | 'off-template' | 'reply-off-template';

export type ExchangeMemoryPlan =
  | { kind: 'none' }
  | { kind: 'sync'; memoryId?: string; pendingId?: string }
  | { kind: 'blocked'; reason: MemorySyncBlockReason };

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
    return 'reply-off-template';
  }
  return null;
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
  if (memory === undefined && pending === undefined) {
    return { kind: 'none' };
  }

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
  const reason = blocks.find(block => block !== 'reply-off-template') ?? blocks.at(0);
  if (reason !== undefined) {
    logger.warn(
      { rowId: row.id, memoryId: memory?.id, pendingId: pending?.id, reason },
      'Exchange memory cannot follow the edit; edit blocked'
    );
    return { kind: 'blocked', reason };
  }

  return { kind: 'sync', memoryId: memory?.id, pendingId: pending?.id };
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
  if (plan.memoryId !== undefined) {
    const memory = await prisma.memory.findUnique({
      where: { id: plan.memoryId },
      select: { content: true },
    });
    const rewritten = memory === null ? null : rewriteReplyInExchangeText(memory.content, newReply);
    if (rewritten === null) {
      logger.warn({ memoryId: plan.memoryId }, 'Planned memory no longer rewritable; skipped');
      allWritten = false;
    } else {
      await writeMemoryContent(prisma, plan.memoryId, rewritten);
    }
  }

  if (plan.pendingId !== undefined) {
    const pending = await prisma.pendingMemory.findUnique({
      where: { id: plan.pendingId },
      select: { text: true },
    });
    const rewritten = pending === null ? null : rewriteReplyInExchangeText(pending.text, newReply);
    if (rewritten === null) {
      logger.warn({ pendingId: plan.pendingId }, 'Planned pending memory gone or unrewritable');
      allWritten = false;
    } else {
      // updateMany: the row can be consumed between the read above and this write,
      // and a vanished row must be a warned skip, not a thrown not-found.
      const { count } = await prisma.pendingMemory.updateMany({
        where: { id: plan.pendingId },
        data: { text: rewritten },
      });
      if (count === 0) {
        logger.warn({ pendingId: plan.pendingId }, 'Planned pending memory gone or unrewritable');
        allWritten = false;
      }
    }
  }
  return allWritten;
}
