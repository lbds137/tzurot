/**
 * NSFW Verification Utilities
 *
 * Provides functions to check and update user NSFW verification status.
 * Users are automatically verified when they interact with the bot in an NSFW channel.
 * Verification is required for DM interactions with personalities.
 */

import {
  ChannelType,
  type Channel,
  type AnyThreadChannel,
  type Message,
  type SendableChannels,
} from 'discord.js';
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
 * Guild text/news channels check their own nsfw property.
 * Thread channels inherit NSFW status from their parent channel.
 */
export function isNsfwChannel(channel: Channel): boolean {
  // Direct NSFW channels (GuildText and GuildNews have nsfw property)
  if (channel.type === ChannelType.GuildText) {
    return channel.nsfw === true;
  }
  if (channel.type === ChannelType.GuildNews) {
    return channel.nsfw === true;
  }

  // Thread channels - check parent's NSFW status
  if (
    channel.type === ChannelType.PublicThread ||
    channel.type === ChannelType.PrivateThread ||
    channel.type === ChannelType.AnnouncementThread
  ) {
    const parent = (channel as AnyThreadChannel).parent;
    if (parent === null) {
      return false;
    }

    // Parent types that have nsfw property
    if (
      parent.type === ChannelType.GuildText ||
      parent.type === ChannelType.GuildNews ||
      parent.type === ChannelType.GuildForum
    ) {
      return parent.nsfw === true;
    }
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

/**
 * Result of NSFW verification flow
 */
export interface NsfwVerificationResult {
  /** Should processing continue? */
  allowed: boolean;
  /** Was this a new verification (first time)? */
  wasNewVerification: boolean;
}

/**
 * Send NSFW verification message and track for cleanup
 * Shared utility to avoid duplication across processors.
 */
export async function sendNsfwVerificationMessage(
  message: Message,
  logPrefix: string
): Promise<void> {
  try {
    const verificationReply = await message.reply(NSFW_VERIFICATION_MESSAGE);
    void trackPendingVerificationMessage(
      message.author.id,
      verificationReply.id,
      verificationReply.channelId
    ).catch(trackError => {
      logger.warn(
        { err: trackError, userId: message.author.id, messageId: verificationReply.id },
        `[${logPrefix}] Failed to track verification message`
      );
    });
  } catch (error) {
    logger.warn(
      { err: error, messageId: message.id },
      `[${logPrefix}] Failed to send NSFW verification message`
    );
  }
}

/**
 * Handle NSFW verification flow for a message
 * - In NSFW channels: auto-verify user and continue
 * - In other channels: check if verified, block if not
 *
 * @returns Result indicating if processing should continue and if this was a new verification
 */
export async function handleNsfwVerification(
  message: Message,
  logPrefix: string
): Promise<NsfwVerificationResult> {
  const userId = message.author.id;
  const { channel } = message;

  // If in NSFW channel, auto-verify and continue
  if (isNsfwChannel(channel)) {
    const verifyResult = await verifyNsfwUser(userId);
    // wasNewVerification is true if verify succeeded AND user wasn't already verified
    const wasNewVerification = verifyResult !== null && !verifyResult.alreadyVerified;
    return { allowed: true, wasNewVerification };
  }

  // For all other channels (DMs and non-NSFW guild channels), check verification
  const nsfwStatus = await checkNsfwVerification(userId);
  if (!nsfwStatus.nsfwVerified) {
    logger.info(
      { userId, channelType: channel.type },
      `[${logPrefix}] Interaction blocked - user not NSFW verified`
    );
    await sendNsfwVerificationMessage(message, logPrefix);
    return { allowed: false, wasNewVerification: false };
  }

  return { allowed: true, wasNewVerification: false };
}

/**
 * How long verification confirmation message stays before self-destructing (ms)
 */
const VERIFICATION_CONFIRMATION_DELETE_DELAY = 10_000;

/**
 * Send a self-destructing confirmation message after first-time verification
 * Only call this when wasNewVerification is true.
 */
export async function sendVerificationConfirmation(
  channel: SendableChannels,
  deleteAfterMs: number = VERIFICATION_CONFIRMATION_DELETE_DELAY
): Promise<void> {
  try {
    const msg = await channel.send(
      '✅ **NSFW verification complete!** You can now chat with personalities anywhere.'
    );
    // Short-lived timer (10s) - acceptable if lost on restart; worst case is
    // an extra confirmation message in channel. Not worth Redis tracking.
    setTimeout(() => {
      msg.delete().catch(() => {
        // Ignore deletion errors (message may already be deleted)
      });
    }, deleteAfterMs);
  } catch {
    // Ignore send errors (permissions, etc.)
  }
}
