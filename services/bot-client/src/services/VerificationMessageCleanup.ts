/**
 * Verification Message Cleanup Service
 *
 * Handles deletion of pending NSFW verification messages:
 * 1. On-demand cleanup when user successfully verifies
 * 2. Scheduled cleanup for messages approaching 13-day limit
 */

import type { Client, DMChannel } from 'discord.js';
import type { Redis } from 'ioredis';
import { ChannelType } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
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
      const expiredMessages: PendingVerificationMessage[] = [];
      const remainingMessages: PendingVerificationMessage[] = [];

      for (const msg of messages) {
        const age = now - msg.timestamp;
        if (age >= MAX_MESSAGE_AGE_MS) {
          expiredMessages.push(msg);
        } else {
          remainingMessages.push(msg);
        }
      }

      // Delete expired messages
      for (const msg of expiredMessages) {
        processed++;
        const success = await this.deleteMessage(msg);
        if (success) {
          deleted++;
        } else {
          failed++;
        }
      }

      // Update Redis with only remaining messages
      // Note: Uses pipeline for performance, but not atomic - a new message could
      // be added between clear and rpush. This is acceptable since worst case is
      // a verification message doesn't get auto-deleted (it expires via 14-day TTL anyway).
      if (expiredMessages.length > 0) {
        const key = `${REDIS_KEY_PREFIX}${userId}`;
        await clearPendingVerificationMessages(this.redis, userId);

        if (remainingMessages.length > 0) {
          const pipeline = this.redis.pipeline();
          for (const msg of remainingMessages) {
            pipeline.rpush(key, JSON.stringify(msg));
          }
          pipeline.expire(key, 14 * 24 * 60 * 60);
          await pipeline.exec();
        }
      }
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
   */
  private async deleteMessage(msg: PendingVerificationMessage): Promise<boolean> {
    try {
      const channel = await this.client.channels.fetch(msg.channelId);

      if (channel?.type !== ChannelType.DM) {
        logger.debug(
          { messageId: msg.messageId, channelId: msg.channelId },
          '[VerificationCleanup] Channel not found or not a DM'
        );
        return false;
      }

      const dmChannel = channel as DMChannel;
      const message = await dmChannel.messages.fetch(msg.messageId);
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
