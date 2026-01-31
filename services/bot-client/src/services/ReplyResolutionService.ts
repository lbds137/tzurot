/**
 * Reply Resolution Service
 *
 * Resolves which personality a reply is targeting by examining the replied-to message.
 * Handles webhook detection (guild channels), bot message detection (DMs),
 * personality lookup, and cross-instance filtering.
 *
 * Lookup Strategy (Tiered):
 * 1. Redis (fast path) - 7-day TTL, stores personality ID directly
 * 2. Database (authoritative) - Query by Discord message ID via api-gateway (DMs only)
 * 3. Display name parsing (last resort) - Parse **Name:** prefix or webhook username
 */

import { ChannelType, type Message } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import type { LoadedPersonality } from '@tzurot/common-types';
import type { IPersonalityLoader } from '../types/IPersonalityLoader.js';
import type { GatewayClient } from '../utils/GatewayClient.js';
import { redisService } from '../redis.js';

const logger = createLogger('ReplyResolutionService');

/**
 * Check if a string identifier is valid (non-null, non-empty)
 */
function isValidIdentifier(value: string | null | undefined): value is string {
  return value !== undefined && value !== null && value.length > 0;
}

/**
 * Resolves personality from replied-to messages
 */
export class ReplyResolutionService {
  constructor(
    private readonly personalityService: IPersonalityLoader,
    private readonly gatewayClient?: GatewayClient
  ) {}

  /**
   * Resolve which personality a reply is targeting
   *
   * Access Control:
   * When userId is provided, only returns personalities that the user has access to
   * (public personalities or ones they own). This prevents the "Reply Loophole"
   * where User B could reply to User A's private personality messages.
   *
   * DM vs Guild:
   * - In guild channels, personality messages are sent via webhooks (webhookId present)
   * - In DMs, personality messages are sent as regular bot messages (author.id === bot.id)
   *
   * @param message - Message that is a reply (message.reference must not be null)
   * @param userId - Discord user ID for access control
   * @returns LoadedPersonality if reply targets an accessible personality, null otherwise
   */
  // eslint-disable-next-line complexity, max-lines-per-function -- Multi-tier lookup (Redis → Database → Display name parsing) for both DM and guild channels requires sequential validation. Discord API nullable fields add necessary checks. All tiers are cohesive to the single task of resolving personality identity.
  async resolvePersonality(message: Message, userId: string): Promise<LoadedPersonality | null> {
    try {
      const messageId = message.reference?.messageId;
      if (!isValidIdentifier(messageId)) {
        logger.warn({}, '[ReplyResolutionService] Called with message that has no reference');
        return null;
      }

      // Fetch the message being replied to
      const referencedMessage = await message.channel.messages.fetch(messageId);
      const isDM = message.channel.type === ChannelType.DM;

      // Validate the replied-to message is from a personality
      if (isDM) {
        // In DMs, bot messages don't have webhookId
        // Check if the replied-to message is from this bot
        if (referencedMessage.author?.id !== message.client.user?.id) {
          logger.debug('[ReplyResolutionService] Reply in DM is not to a bot message, skipping');
          return null;
        }
        logger.debug('[ReplyResolutionService] DM reply to bot message detected');
      } else {
        // In guild channels, require webhookId (personality messages are sent via webhooks)
        if (!isValidIdentifier(referencedMessage.webhookId)) {
          logger.debug('[ReplyResolutionService] Reply is to a non-webhook message, skipping');
          return null;
        }

        // Check if this webhook belongs to the current bot instance
        // This prevents both dev and prod bots from responding to the same personality webhook
        if (
          isValidIdentifier(referencedMessage.applicationId) &&
          referencedMessage.applicationId !== message.client.user.id
        ) {
          logger.debug(
            {
              webhookApplicationId: referencedMessage.applicationId,
              currentBotId: message.client.user.id,
            },
            '[ReplyResolutionService] Ignoring reply to webhook from different bot instance'
          );
          return null;
        }
      }

      // Tier 1: Try Redis lookup first (fast path for recent messages)
      // Redis stores personality ID (UUID), not name, to avoid slug/name collisions
      let personalityIdOrName = await redisService.getWebhookPersonality(referencedMessage.id);

      // Check if Redis value is a UUID (new format) vs name (legacy format)
      const isUUID =
        isValidIdentifier(personalityIdOrName) &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(personalityIdOrName);

      if (isUUID) {
        logger.debug(
          { personalityId: personalityIdOrName },
          '[ReplyResolutionService] Found personality ID in Redis (tier 1)'
        );
      }

      // Tier 2: Database lookup (authoritative - handles display name collisions)
      // Only for DMs when Redis misses, since guild webhooks have username fallback
      if (!isValidIdentifier(personalityIdOrName) && isDM && this.gatewayClient !== undefined) {
        const dbResult = await this.gatewayClient.lookupPersonalityFromConversation(
          referencedMessage.id
        );
        if (dbResult !== null) {
          personalityIdOrName = dbResult.personalityId;
          logger.debug(
            { personalityId: personalityIdOrName },
            '[ReplyResolutionService] Found personality via database lookup (tier 2)'
          );
        }
      }

      // Tier 3: Display name parsing (last resort)
      if (!isValidIdentifier(personalityIdOrName)) {
        if (isDM && referencedMessage.content) {
          // DM format: **DisplayName:** message content
          // Regex excludes colons and newlines from display name to prevent edge cases
          const prefixMatch = /^\*\*([^:\n]+?):\*\*/.exec(referencedMessage.content);
          if (prefixMatch) {
            personalityIdOrName = prefixMatch[1];
            logger.debug(
              { displayName: personalityIdOrName },
              '[ReplyResolutionService] Parsed display name from DM message prefix (tier 3)'
            );
          }
        } else if (
          !isDM &&
          referencedMessage.author !== undefined &&
          referencedMessage.author !== null
        ) {
          // Guild format: Webhook username is "DisplayName | BotName"
          const webhookUsername = referencedMessage.author.username;
          if (webhookUsername.includes(' | ')) {
            personalityIdOrName = webhookUsername.split(' | ')[0].trim();
            logger.debug(
              { personalityName: personalityIdOrName },
              '[ReplyResolutionService] Extracted personality name from webhook username (tier 3)'
            );
          }
        }
      }

      if (!isValidIdentifier(personalityIdOrName)) {
        logger.debug('[ReplyResolutionService] No personality found for replied message');
        return null;
      }

      // Load the personality from database with access control
      // This prevents the "Reply Loophole" - users can't interact with
      // private personalities by replying to messages from other users
      // Note: PersonalityLoader prioritizes UUID > Name > Slug, so UUID lookup is direct
      const personality = await this.personalityService.loadPersonality(
        personalityIdOrName,
        userId
      );

      if (!personality) {
        logger.debug(
          { personalityIdOrName, userId },
          '[ReplyResolutionService] Personality not found or access denied'
        );
        return null;
      }

      logger.info(
        { personalityName: personality.displayName, userId, isDM },
        '[ReplyResolutionService] Resolved personality from reply'
      );

      return personality;
    } catch (error) {
      // If we can't fetch the referenced message, it might be deleted or inaccessible
      logger.debug(
        { err: error },
        '[ReplyResolutionService] Could not fetch or process referenced message'
      );
      return null;
    }
  }
}
