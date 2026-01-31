/**
 * Pending NSFW Verification Messages Tracker
 *
 * Tracks verification messages sent to users in DMs so they can be
 * cleaned up after successful verification or before Discord's 14-day
 * message deletion limit.
 */

import { createLogger } from '@tzurot/common-types';
import type { Redis } from 'ioredis';
import { z } from 'zod';

const logger = createLogger('pending-verification-messages');

/** Redis key prefix for pending verification messages */
export const REDIS_KEY_PREFIX = 'nsfw:verification:pending:';

/** Zod schema for runtime validation of Redis data */
const PendingVerificationMessageSchema = z.object({
  messageId: z.string(),
  channelId: z.string(),
  timestamp: z.number(),
});

/**
 * Maximum age before forced deletion (13 days in milliseconds).
 *
 * WHY 13 DAYS: Discord's API returns 10008 (Unknown Message) for messages
 * older than 14 days - they cannot be deleted after that point. We use 13 days
 * to give ourselves a 1-day safety buffer for the scheduled cleanup job
 * (which runs every 6 hours) to catch and delete messages before Discord
 * makes them permanently undeletable.
 */
export const MAX_MESSAGE_AGE_MS = 13 * 24 * 60 * 60 * 1000;

/** TTL for Redis keys (14 days - after this, Discord won't let us delete anyway) */
const REDIS_TTL_SECONDS = 14 * 24 * 60 * 60;

export interface PendingVerificationMessage {
  messageId: string;
  channelId: string;
  timestamp: number;
}

/**
 * Store a pending verification message for a user
 */
export async function storePendingVerificationMessage(
  redis: Redis,
  userId: string,
  message: PendingVerificationMessage
): Promise<void> {
  const key = `${REDIS_KEY_PREFIX}${userId}`;

  try {
    // Store as JSON in a list (user might have multiple pending messages)
    await redis.rpush(key, JSON.stringify(message));
    // Set TTL to auto-expire after 14 days
    await redis.expire(key, REDIS_TTL_SECONDS);

    logger.debug(
      { userId, messageId: message.messageId, channelId: message.channelId },
      '[PendingVerification] Stored pending verification message'
    );
  } catch (error) {
    logger.warn(
      { err: error, userId, messageId: message.messageId },
      '[PendingVerification] Failed to store pending verification message'
    );
  }
}

/**
 * Get all pending verification messages for a user
 */
export async function getPendingVerificationMessages(
  redis: Redis,
  userId: string
): Promise<PendingVerificationMessage[]> {
  const key = `${REDIS_KEY_PREFIX}${userId}`;

  try {
    const items = await redis.lrange(key, 0, -1);
    const validMessages: PendingVerificationMessage[] = [];

    for (const item of items) {
      try {
        const parsed: unknown = JSON.parse(item);
        const result = PendingVerificationMessageSchema.safeParse(parsed);
        if (result.success) {
          validMessages.push(result.data);
        } else {
          logger.warn(
            { userId, rawItem: item, errors: result.error.flatten() },
            '[PendingVerification] Skipping invalid message data in Redis'
          );
        }
      } catch (parseError) {
        logger.warn(
          { err: parseError, userId, rawItem: item },
          '[PendingVerification] Failed to parse JSON from Redis'
        );
      }
    }

    return validMessages;
  } catch (error) {
    logger.warn(
      { err: error, userId },
      '[PendingVerification] Failed to get pending verification messages'
    );
    return [];
  }
}

/**
 * Clear all pending verification messages for a user (after successful verification)
 */
export async function clearPendingVerificationMessages(
  redis: Redis,
  userId: string
): Promise<void> {
  const key = `${REDIS_KEY_PREFIX}${userId}`;

  try {
    await redis.del(key);
    logger.debug({ userId }, '[PendingVerification] Cleared pending verification messages');
  } catch (error) {
    logger.warn(
      { err: error, userId },
      '[PendingVerification] Failed to clear pending verification messages'
    );
  }
}

/**
 * Get all user IDs with pending verification messages
 * Used by the cleanup job to find messages approaching the 13-day limit
 *
 * Note: Uses SCAN instead of KEYS to avoid blocking Redis.
 * KEYS is O(N) and blocks the entire event loop, which can cause
 * production issues as the user base grows.
 */
export async function getAllPendingVerificationUserIds(redis: Redis): Promise<string[]> {
  const userIds: string[] = [];

  try {
    // Use scanStream for non-blocking iteration over matching keys
    const stream = redis.scanStream({
      match: `${REDIS_KEY_PREFIX}*`,
      count: 100,
    });

    for await (const keys of stream) {
      for (const key of keys as string[]) {
        userIds.push(key.replace(REDIS_KEY_PREFIX, ''));
      }
    }

    return userIds;
  } catch (error) {
    logger.warn({ err: error }, '[PendingVerification] Failed to scan pending user IDs');
    return [];
  }
}
