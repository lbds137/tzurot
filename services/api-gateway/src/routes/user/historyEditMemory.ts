/**
 * Rewrites the long-term memory of one exchange after its assistant reply was
 * edited.
 *
 * A memory keys on the TRIGGER (user) message id, not the reply's, and stores
 * `{user}: <message>\n{assistant}: <reply>`. So the memory for an edited reply
 * is found in two hops: the user row that triggered the reply, then the memory
 * whose `messageIds` contain that row's Discord id.
 *
 * Every skip path returns `false` without throwing: a memory that cannot be
 * rewritten safely is left as-is rather than risking the wrong one.
 */

import { findImmediateTriggerRow } from '@tzurot/conversation-history';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  ASSISTANT_SEPARATOR,
  REFERENCED_BLOCK_RE,
  splitMemoryContent,
} from '@tzurot/common-types/utils/memoryContentSplit';
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
 * Rewrite the assistant half of the exchange's memory with `newReply`.
 *
 * @returns true when a memory was rewritten; false when none was found or the
 * one found could not be rewritten safely (never an error).
 */
export async function rewriteExchangeMemory(
  prisma: PrismaClient,
  row: EditedReplyRow,
  newReply: string
): Promise<boolean> {
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
    logger.debug({ rowId: row.id }, 'No trigger row for the edited reply; memory left as-is');
    return false;
  }

  const memories = await prisma.memory.findMany({
    where: {
      messageIds: { hasSome: trigger.discordMessageId },
      personalityId,
      personaId,
      visibility: 'normal',
    },
    select: { id: true, content: true, isLocked: true, chunkGroupId: true },
    take: 2,
  });

  if (memories.length === 0) {
    return false;
  }
  if (memories.length > 1) {
    logger.warn(
      { rowId: row.id, matchCount: memories.length },
      'Ambiguous exchange memory match; memory left as-is'
    );
    return false;
  }

  const memory = memories[0];
  if (memory.isLocked) {
    logger.info({ rowId: row.id, memoryId: memory.id }, 'Exchange memory is locked; left as-is');
    return false;
  }
  if (memory.chunkGroupId !== null) {
    logger.info({ rowId: row.id, memoryId: memory.id }, 'Exchange memory is chunked; left as-is');
    return false;
  }
  if (splitMemoryContent(memory.content) === null) {
    logger.warn(
      { rowId: row.id, memoryId: memory.id },
      'Exchange memory does not match the stored template; left as-is'
    );
    return false;
  }

  const sepIndex = memory.content.indexOf(ASSISTANT_SEPARATOR);
  const oldTail = memory.content.slice(sepIndex + ASSISTANT_SEPARATOR.length);
  const trailingRef = REFERENCED_BLOCK_RE.exec(oldTail)?.[0] ?? '';
  const newContent =
    memory.content.slice(0, sepIndex + ASSISTANT_SEPARATOR.length) + newReply + trailingRef;

  await writeMemoryContent(prisma, memory.id, newContent);
  return true;
}
