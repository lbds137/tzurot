/**
 * NSFW Verification Utilities
 *
 * Provides functions to check and update user NSFW verification status.
 * Users are automatically verified when they interact with the bot in an NSFW channel.
 * Verification is required for DM interactions with personalities.
 */

import { ChannelType, type Channel } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { callGatewayApi } from './userGatewayClient.js';
import { redis } from '../redis.js';
import { storePendingVerificationMessage } from './pendingVerificationMessages.js';
import { cleanupVerificationMessagesForUser } from '../services/VerificationCleanupService.js';

const logger = createLogger('nsfw-verification');

export interface NsfwStatus {
  nsfwVerified: boolean;
  nsfwVerifiedAt: string | null;
}

export interface NsfwVerifyResponse {
  nsfwVerified: boolean;
  nsfwVerifiedAt: string | null;
  alreadyVerified: boolean;
}

/**
 * Check if a user is NSFW verified
 */
export async function checkNsfwVerification(userId: string): Promise<NsfwStatus> {
  const result = await callGatewayApi<NsfwStatus>('/user/nsfw', {
    method: 'GET',
    userId,
  });

  if (!result.ok) {
    logger.warn({ userId, error: result.error }, '[NSFW] Failed to check verification status');
    return { nsfwVerified: false, nsfwVerifiedAt: null };
  }

  return result.data;
}

/**
 * Mark a user as NSFW verified
 * Called when user interacts with the bot in an NSFW Discord channel
 */
export async function verifyNsfwUser(userId: string): Promise<NsfwVerifyResponse | null> {
  const result = await callGatewayApi<NsfwVerifyResponse>('/user/nsfw/verify', {
    method: 'POST',
    userId,
  });

  if (!result.ok) {
    logger.warn({ userId, error: result.error }, '[NSFW] Failed to verify user');
    return null;
  }

  if (!result.data.alreadyVerified) {
    logger.info({ userId }, '[NSFW] User verified via NSFW channel interaction');

    // Clean up any pending verification messages since user is now verified
    void cleanupVerificationMessagesForUser(userId).catch(cleanupError => {
      logger.warn(
        { err: cleanupError, userId },
        '[NSFW] Failed to cleanup verification messages after verification'
      );
    });
  }

  return result.data;
}

/**
 * Check if a Discord channel is marked as NSFW (age-restricted)
 * Only guild text channels can be NSFW; DMs and threads cannot
 */
export function isNsfwChannel(channel: Channel): boolean {
  // Guild text channels have the nsfw property
  // After the type check, TypeScript knows channel is the right type
  if (channel.type === ChannelType.GuildText) {
    return channel.nsfw === true;
  }
  if (channel.type === ChannelType.GuildNews) {
    return channel.nsfw === true;
  }
  return false;
}

/**
 * Check if a Discord channel is a DM channel
 */
export function isDMChannel(channel: Channel): boolean {
  return channel.type === ChannelType.DM;
}

/**
 * NSFW verification requirement message
 */
export const NSFW_VERIFICATION_MESSAGE = `
**Age Verification Required**

To chat with me, I need to verify that you're an adult. This is a one-time verification.

**How to verify:**
1. Go to any Discord server with an **NSFW (age-restricted) channel**
2. Send me a message there using \`@personality_name hello\`
3. Once verified, you can chat with me anywhere!

*Note: Discord only shows NSFW channels to users who have confirmed they're 18+ in their Discord settings.*
`.trim();

/**
 * Track a pending verification message for later cleanup
 * Called after sending a verification message to a DM
 */
export async function trackPendingVerificationMessage(
  userId: string,
  messageId: string,
  channelId: string
): Promise<void> {
  await storePendingVerificationMessage(redis, userId, {
    messageId,
    channelId,
    timestamp: Date.now(),
  });
}
