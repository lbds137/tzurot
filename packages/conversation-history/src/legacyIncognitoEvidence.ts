/**
 * Legacy incognito evidence lookup for assistant replies that predate `messageMetadata.incognito`.
 */

import { MessageRole, REPLY_PAIRING_WINDOW_MS } from '@tzurot/common-types/constants/message';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';

/**
 * Find the user row that triggered a reply: the immediately preceding row (any
 * role) in the same channel and personality, bounded to
 * {@link REPLY_PAIRING_WINDOW_MS} before the reply (`>= reply -
 * REPLY_PAIRING_WINDOW_MS` and `< reply`). Exact-offset pairing is impossible
 * (user and reply rows sit tens of ms to seconds apart), and the window bound
 * stops an unrelated older user row from binding to a reply that has no
 * trigger row of its own (such as a weigh-in). Accepted residue: a
 * trigger-less reply preceded within 60s by another user's row still binds to
 * it unless `personaId` is given, which also scopes the lookup to that persona.
 *
 * @returns the trigger's Discord message id(s), or `null` when the preceding
 * row is outside the window, is not a user turn, or has no Discord message id.
 */
export async function findImmediateTriggerRow(
  prisma: Pick<PrismaClient, 'conversationHistory'>,
  row: { channelId: string; personalityId: string; personaId?: string; createdAt: Date }
): Promise<{ discordMessageId: string[] } | null> {
  const { channelId, personalityId } = row;
  // Omit deletedAt so a soft-deleted trigger does not fall through to an earlier turn (see triggerReferenceWriter.ts).
  const trigger = await prisma.conversationHistory.findFirst({
    where: {
      channelId,
      personalityId,
      ...(row.personaId !== undefined && { personaId: row.personaId }),
      createdAt: {
        lt: row.createdAt,
        gte: new Date(row.createdAt.getTime() - REPLY_PAIRING_WINDOW_MS),
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { role: true, discordMessageId: true },
  });

  if (trigger?.role !== (MessageRole.User as string) || trigger.discordMessageId.length === 0) {
    return null;
  }
  return { discordMessageId: trigger.discordMessageId };
}

/**
 * Check whether the trigger row of a reply (see {@link findImmediateTriggerRow})
 * has a live (`visibility: 'normal'`) long-term memory linked to its Discord
 * message id(s). Memories key on the trigger (user) message id rather than the
 * reply's (`LongTermMemoryService.ts` `buildMemoryMetadata`); if there is no
 * such trigger row, or it has no live memory, this returns `false` so the
 * caller fails toward privacy (incognito).
 */
export async function triggerMemoryExists(
  prisma: Pick<PrismaClient, 'conversationHistory' | 'memory'>,
  row: { channelId: string; personalityId: string; createdAt: Date }
): Promise<boolean> {
  const { personalityId } = row;
  const trigger = await findImmediateTriggerRow(prisma, row);
  if (trigger === null) {
    return false;
  }

  const memory = await prisma.memory.findFirst({
    where: {
      messageIds: { hasSome: trigger.discordMessageId },
      personalityId,
      visibility: 'normal',
    },
    select: { id: true },
  });

  return memory !== null;
}
