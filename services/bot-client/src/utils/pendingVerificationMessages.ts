/**
 * Pending NSFW Verification Messages Tracker
 *
 * Tracks verification messages sent to users in DMs so they can be
 * cleaned up after successful verification or before Discord's 14-day
 * message deletion limit.
 */

import { createLogger } from '@tzurot/common-types';
import type { Redis } from 'ioredis';

const logger = createLogger('pending-verification-messages');

/** Redis key prefix for pending verification messages */
const REDIS_KEY_PREFIX = 'nsfw:verification:pending:';

/** Maximum age before forced deletion (13 days in ms, leaving 1 day buffer before Discord's 14-day limit) */
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
    return items.map(item => JSON.parse(item) as PendingVerificationMessage);
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
 */
export async function getAllPendingVerificationUserIds(redis: Redis): Promise<string[]> {
  try {
    const keys = await redis.keys(`${REDIS_KEY_PREFIX}*`);
    return keys.map(key => key.replace(REDIS_KEY_PREFIX, ''));
  } catch (error) {
    logger.warn({ err: error }, '[PendingVerification] Failed to get all pending user IDs');
    return [];
  }
}
