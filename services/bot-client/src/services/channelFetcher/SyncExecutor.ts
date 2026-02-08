/**
 * Database sync executor for DiscordChannelFetcher.
 *
 * Performs opportunistic sync between Discord messages and database,
 * detecting edits and deletes.
 */

import type { Message, Collection } from 'discord.js';
import { createLogger, type ConversationSyncService } from '@tzurot/common-types';
import { collateChunksForSync, contentsDiffer, getOldestTimestamp } from './SyncValidator.js';
import type { SyncResult } from './types.js';

const logger = createLogger('DiscordChannelFetcher');

/**
 * Perform opportunistic sync between Discord messages and database.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Sync logic has inherent complexity
export async function executeDatabaseSync(
  discordMessages: Collection<string, Message>,
  channelId: string,
  personalityId: string,
  conversationSync: ConversationSyncService
): Promise<SyncResult> {
  const result: SyncResult = { updated: 0, deleted: 0 };

  try {
    const discordMessageIds = [...discordMessages.keys()];
    if (discordMessageIds.length === 0) {
      return result;
    }

    const dbMessages = await conversationSync.getMessagesByDiscordIds(
      discordMessageIds,
      channelId,
      personalityId
    );

    if (dbMessages.size === 0) {
      logger.debug(
        { channelId, discordCount: discordMessageIds.length },
        '[DiscordChannelFetcher] No matching DB messages for sync'
      );
      return result;
    }

    // Check for edits - group Discord messages by their DB record first
    const dbRecordToChunks = new Map<
      string,
      { dbMsg: typeof dbMessages extends Map<string, infer V> ? V : never; chunks: Message[] }
    >();

    for (const [discordId, discordMsg] of discordMessages) {
      const dbMsg = dbMessages.get(discordId);
      if (dbMsg?.deletedAt === null) {
        const existing = dbRecordToChunks.get(dbMsg.id);
        if (existing) {
          existing.chunks.push(discordMsg);
        } else {
          dbRecordToChunks.set(dbMsg.id, { dbMsg, chunks: [discordMsg] });
        }
      }
    }

    // Process each unique DB record
    for (const [dbId, { dbMsg, chunks }] of dbRecordToChunks) {
      const collatedContent = collateChunksForSync(dbId, dbMsg, chunks);
      if (collatedContent === null) {
        continue;
      }

      if (contentsDiffer(collatedContent, dbMsg.content)) {
        const updated = await conversationSync.updateMessageContent(dbId, collatedContent);
        if (updated) {
          result.updated++;
          logger.debug(
            { messageId: dbId, chunkCount: chunks.length },
            '[DiscordChannelFetcher] Synced edited message'
          );
        }
      }
    }

    // Check for deletes
    const oldestDiscordTime = getOldestTimestamp(discordMessages);
    if (oldestDiscordTime) {
      const dbMessagesInWindow = await conversationSync.getMessagesInTimeWindow(
        channelId,
        personalityId,
        oldestDiscordTime
      );

      const discordIdSet = new Set(discordMessageIds);
      const deletedMessageIds: string[] = [];

      for (const dbMsg of dbMessagesInWindow) {
        const hasMatchingDiscordId = dbMsg.discordMessageId.some((id: string) =>
          discordIdSet.has(id)
        );
        if (!hasMatchingDiscordId) {
          deletedMessageIds.push(dbMsg.id);
        }
      }

      if (deletedMessageIds.length > 0) {
        const deleteCount = await conversationSync.softDeleteMessages(deletedMessageIds);
        result.deleted = deleteCount;
        logger.info(
          { channelId, deletedCount: deleteCount },
          '[DiscordChannelFetcher] Soft deleted messages not found in Discord'
        );
      }
    }

    if (result.updated > 0 || result.deleted > 0) {
      logger.info(
        { channelId, personalityId, updated: result.updated, deleted: result.deleted },
        '[DiscordChannelFetcher] Opportunistic sync completed'
      );
    }

    return result;
  } catch (error) {
    logger.error(
      { channelId, personalityId, error: error instanceof Error ? error.message : String(error) },
      '[DiscordChannelFetcher] Sync failed'
    );
    return result;
  }
}
