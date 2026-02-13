/**
 * Verification Message Cleanup Service
 *
 * Handles deletion of pending NSFW verification messages:
 * 1. On-demand cleanup when user successfully verifies
 * 2. Scheduled cleanup for messages approaching 13-day limit
 */

import type { Client } from 'discord.js';
import type { Redis } from 'ioredis';
import { createLogger } from '@tzurot/common-types';
import { isTextBasedMessageChannel } from '../utils/discordChannelTypes.js';
import {
  getPendingVerificationMessages,
  clearPendingVerificationMessages,
  getAllPendingVerificationUserIds,
  MAX_MESSAGE_AGE_MS,
  REDIS_KEY_PREFIX,
  type PendingVerificationMessage,
} from '../utils/pendingVerificationMessages.js';

const logger = createLogger('verification-message-cleanup');

export class VerificationMessageCleanup {
  constructor(
    private readonly client: Client,
    private readonly redis: Redis
  ) {}

  /**
   * Clean up all pending verification messages for a user after successful verification
   */
  async cleanupForUser(userId: string): Promise<void> {
    const messages = await getPendingVerificationMessages(this.redis, userId);

    if (messages.length === 0) {
      return;
    }

    logger.info(
      { userId, messageCount: messages.length },
      '[VerificationCleanup] Cleaning up verification messages after successful verification'
    );

    let deletedCount = 0;
    let failedCount = 0;

    for (const msg of messages) {
      const success = await this.deleteMessage(msg);
      if (success) {
        deletedCount++;
      } else {
        failedCount++;
      }
    }

    // Clear the Redis tracking regardless of deletion success
    // (if we couldn't delete, Discord might have already deleted them or channel is gone)
    await clearPendingVerificationMessages(this.redis, userId);

    logger.info(
      { userId, deletedCount, failedCount },
      '[VerificationCleanup] Completed cleanup for user'
    );
  }

  /**
   * Partition messages into expired and remaining based on age
   */
  private partitionByAge(
    messages: PendingVerificationMessage[],
    now: number
  ): { expired: PendingVerificationMessage[]; remaining: PendingVerificationMessage[] } {
    const expired: PendingVerificationMessage[] = [];
    const remaining: PendingVerificationMessage[] = [];
    for (const msg of messages) {
      if (now - msg.timestamp >= MAX_MESSAGE_AGE_MS) {
        expired.push(msg);
      } else {
        remaining.push(msg);
      }
    }
    return { expired, remaining };
  }

  /**
   * Delete multiple messages and return success/failure counts
   */
  private async deleteMessages(
    messages: PendingVerificationMessage[]
  ): Promise<{ deleted: number; failed: number }> {
    let deleted = 0;
    let failed = 0;
    for (const msg of messages) {
      if (await this.deleteMessage(msg)) {
        deleted++;
      } else {
        failed++;
      }
    }
    return { deleted, failed };
  }

  /**
   * Update Redis to keep only remaining (non-expired) messages for a user
   * Note: Not atomic — a new message could be added between clear and rpush.
   * Acceptable since worst case is a message isn't auto-deleted (14-day TTL covers it).
   */
  private async updateRemainingMessages(
    userId: string,
    remaining: PendingVerificationMessage[]
  ): Promise<void> {
    await clearPendingVerificationMessages(this.redis, userId);
    if (remaining.length > 0) {
      const key = `${REDIS_KEY_PREFIX}${userId}`;
      const pipeline = this.redis.pipeline();
      for (const msg of remaining) {
        pipeline.rpush(key, JSON.stringify(msg));
      }
      pipeline.expire(key, 14 * 24 * 60 * 60);
      await pipeline.exec();
    }
  }

  /**
   * Clean up messages that are approaching the 13-day limit
   * Called by scheduled job
   */
  async cleanupExpiredMessages(): Promise<{ processed: number; deleted: number; failed: number }> {
    const userIds = await getAllPendingVerificationUserIds(this.redis);
    const now = Date.now();

    let processed = 0;
    let deleted = 0;
    let failed = 0;

    for (const userId of userIds) {
      const messages = await getPendingVerificationMessages(this.redis, userId);
      const { expired, remaining } = this.partitionByAge(messages, now);

      if (expired.length === 0) {
        continue;
      }

      processed += expired.length;
      const result = await this.deleteMessages(expired);
      deleted += result.deleted;
      failed += result.failed;

      await this.updateRemainingMessages(userId, remaining);
    }

    if (processed > 0) {
      logger.info(
        { processed, deleted, failed },
        '[VerificationCleanup] Completed scheduled cleanup of expired messages'
      );
    }

    return { processed, deleted, failed };
  }

  /**
   * Discord API error codes that are expected during message deletion
   * These don't indicate bugs and are logged at debug level
   */
  private static readonly EXPECTED_ERROR_CODES = new Set([
    10008, // Unknown Message - message already deleted
    10003, // Unknown Channel - channel deleted
    50001, // Missing Access - bot lost permissions or user blocked
    50013, // Missing Permissions - can't delete in this context
  ]);

  /**
   * Delete a single message from Discord
   * Works for DM channels and guild text channels
   */
  private async deleteMessage(msg: PendingVerificationMessage): Promise<boolean> {
    try {
      const channel = await this.client.channels.fetch(msg.channelId);

      // Check if channel supports message operations (DM, GuildText, GuildNews, threads)
      if (!isTextBasedMessageChannel(channel)) {
        logger.debug(
          { messageId: msg.messageId, channelId: msg.channelId, channelType: channel?.type },
          '[VerificationCleanup] Channel not found or does not support message deletion'
        );
        return false;
      }

      const message = await channel.messages.fetch(msg.messageId);
      await message.delete();

      logger.debug(
        { messageId: msg.messageId, channelId: msg.channelId },
        '[VerificationCleanup] Successfully deleted verification message'
      );

      return true;
    } catch (error) {
      const errorCode = (error as { code?: number }).code;
      const isExpected =
        errorCode !== undefined && VerificationMessageCleanup.EXPECTED_ERROR_CODES.has(errorCode);

      if (isExpected) {
        // Expected errors: message/channel deleted, permissions changed
        logger.debug(
          { err: error, messageId: msg.messageId, channelId: msg.channelId, errorCode },
          '[VerificationCleanup] Failed to delete message (expected condition)'
        );
      } else {
        // Unexpected errors: network issues, API bugs, rate limits
        logger.warn(
          { err: error, messageId: msg.messageId, channelId: msg.channelId, errorCode },
          '[VerificationCleanup] Unexpected error deleting message'
        );
      }
      return false;
    }
  }
}
