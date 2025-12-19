/**
 * Activated Channel Processor
 *
 * Handles auto-responses in channels where a personality is activated.
 * Checks if the channel has an activated personality and responds to all messages
 * without requiring @mentions.
 *
 * This processor should be placed AFTER ReplyMessageProcessor but BEFORE
 * PersonalityMentionProcessor in the chain, so explicit replies take priority.
 */

import type { Message } from 'discord.js';
import { createLogger, INTERVALS } from '@tzurot/common-types';
import type { IMessageProcessor } from './IMessageProcessor.js';
import type { IPersonalityLoader } from '../types/IPersonalityLoader.js';
import { GatewayClient } from '../utils/GatewayClient.js';
import { PersonalityMessageHandler } from '../services/PersonalityMessageHandler.js';
import { VoiceMessageProcessor } from './VoiceMessageProcessor.js';

const logger = createLogger('ActivatedChannelProcessor');

/** How long to wait before notifying the same user again about private personality access (1 hour) */
const NOTIFICATION_COOLDOWN_MS = INTERVALS.ONE_HOUR_MS;

/** Cache to track which users have been notified about private personality access */
const notificationCache = new Map<string, number>();

/**
 * Check if we should notify a user about private personality access.
 * Uses a cooldown to prevent spamming the same user.
 */
function shouldNotifyUser(channelId: string, userId: string): boolean {
  const key = `${channelId}:${userId}`;
  const lastNotified = notificationCache.get(key);
  const now = Date.now();

  if (lastNotified !== undefined && now - lastNotified < NOTIFICATION_COOLDOWN_MS) {
    return false; // Still in cooldown period
  }

  notificationCache.set(key, now);
  return true;
}

/**
 * Periodically clean up old entries from the notification cache.
 * Called internally to prevent memory leaks.
 */
function cleanupNotificationCache(): void {
  const now = Date.now();
  for (const [key, timestamp] of notificationCache.entries()) {
    if (now - timestamp > NOTIFICATION_COOLDOWN_MS) {
      notificationCache.delete(key);
    }
  }
}

/**
 * Reset the notification cache. Exported for testing only.
 * @internal
 */
export function _resetNotificationCacheForTesting(): void {
  notificationCache.clear();
}

/**
 * Get the current size of the notification cache. Exported for testing only.
 * @internal
 */
export function _getNotificationCacheSizeForTesting(): number {
  return notificationCache.size;
}

/**
 * Add an entry to the notification cache with a specific timestamp. Exported for testing only.
 * @internal
 */
export function _addNotificationCacheEntryForTesting(
  channelId: string,
  userId: string,
  timestamp: number
): void {
  const key = `${channelId}:${userId}`;
  notificationCache.set(key, timestamp);
}

/**
 * Trigger cleanup of the notification cache. Exported for testing only.
 * @internal
 */
export function _triggerCleanupForTesting(): void {
  cleanupNotificationCache();
}

// Start periodic cleanup interval to prevent memory leaks
// This runs every hour to remove expired cache entries
// Safe for bot-client: single-instance, local UI state (not horizontally scaled)
setInterval(cleanupNotificationCache, INTERVALS.ONE_HOUR_MS);

export class ActivatedChannelProcessor implements IMessageProcessor {
  constructor(
    private readonly gatewayClient: GatewayClient,
    private readonly personalityService: IPersonalityLoader,
    private readonly personalityHandler: PersonalityMessageHandler
  ) {}

  async process(message: Message): Promise<boolean> {
    const channelId = message.channelId;
    const userId = message.author.id;

    // Check if this channel has an activated personality
    const activation = await this.gatewayClient.getChannelActivation(channelId);

    if (activation?.isActivated !== true || activation?.activation === undefined) {
      return false; // No activation, continue chain
    }

    const { personalitySlug, personalityName } = activation.activation;

    logger.debug(
      { channelId, personalitySlug, userId },
      '[ActivatedChannelProcessor] Channel has activated personality'
    );

    // Load the personality with access control
    // Pass userId to enforce access - user must have access to the personality
    const personality = await this.personalityService.loadPersonality(personalitySlug, userId);

    if (!personality) {
      // Personality was deleted, or user lacks access
      // This can happen if a private personality was activated but the user
      // sending the message isn't the owner
      logger.debug(
        { channelId, personalitySlug, personalityName, userId },
        '[ActivatedChannelProcessor] Personality not accessible to user, skipping auto-response'
      );

      // Notify the user (with rate limiting to avoid spam)
      if (shouldNotifyUser(channelId, userId)) {
        try {
          await message.reply({
            content: `📍 This channel has **${personalityName}** activated, but it's a private personality you don't have access to. You can still @mention other personalities or ask the personality owner for access.`,
            allowedMentions: { repliedUser: false }, // Don't ping the user
          });
        } catch (error) {
          logger.warn(
            { err: error, channelId, userId },
            '[ActivatedChannelProcessor] Failed to send private personality notification'
          );
        }
      }

      return false; // Continue chain - let other processors handle it
    }

    // Get voice transcript if available (set by VoiceMessageProcessor earlier in chain)
    const voiceTranscript = VoiceMessageProcessor.getVoiceTranscript(message);
    const content = voiceTranscript ?? message.content;

    // Handle the message with isAutoResponse flag
    await this.personalityHandler.handleMessage(message, personality, content, {
      isAutoResponse: true,
    });

    logger.info(
      { channelId, personalityName: personality.displayName, userId },
      '[ActivatedChannelProcessor] Auto-responded via channel activation'
    );

    return true; // Stop processing - we handled the message
  }
}
