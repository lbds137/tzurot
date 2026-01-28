/**
 * Reply Resolution Service
 *
 * Resolves which personality a reply is targeting by examining the replied-to message.
 * Handles webhook detection, personality lookup, and cross-instance filtering.
 */

import type { Message } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import type { LoadedPersonality } from '@tzurot/common-types';
import type { IPersonalityLoader } from '../types/IPersonalityLoader.js';
import { redisService } from '../redis.js';

const logger = createLogger('ReplyResolutionService');

/**
 * Resolves personality from replied-to messages
 */
export class ReplyResolutionService {
  constructor(private readonly personalityService: IPersonalityLoader) {}

  /**
   * Resolve which personality a reply is targeting
   *
   * Access Control:
   * When userId is provided, only returns personalities that the user has access to
   * (public personalities or ones they own). This prevents the "Reply Loophole"
   * where User B could reply to User A's private personality messages.
   *
   * @param message - Message that is a reply (message.reference must not be null)
   * @param userId - Discord user ID for access control
   * @returns LoadedPersonality if reply targets an accessible personality, null otherwise
   */
  // eslint-disable-next-line complexity -- Discord API returns nullable fields requiring explicit checks (webhookId, applicationId, author). Redis lookup with UUID detection adds necessary branching. Webhook username parsing is a fallback path. All branches are related to the single task of resolving personality identity.
  async resolvePersonality(message: Message, userId: string): Promise<LoadedPersonality | null> {
    try {
      const messageId = message.reference?.messageId;
      if (messageId === undefined || messageId === null || messageId.length === 0) {
        logger.warn({}, '[ReplyResolutionService] Called with message that has no reference');
        return null;
      }

      // Fetch the message being replied to
      const referencedMessage = await message.channel.messages.fetch(messageId);

      // Check if it's from a webhook (personality message)
      if (referencedMessage.webhookId === undefined || referencedMessage.webhookId === null) {
        logger.debug('[ReplyResolutionService] Reply is to a non-webhook message, skipping');
        return null;
      }

      // Check if this webhook belongs to the current bot instance
      // This prevents both dev and prod bots from responding to the same personality webhook
      if (
        referencedMessage.applicationId !== undefined &&
        referencedMessage.applicationId !== null &&
        referencedMessage.applicationId.length > 0 &&
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

      // Try Redis lookup first (fast path for recent messages)
      // Redis now stores personality ID (UUID), not name, to avoid slug/name collisions
      let personalityIdOrName = await redisService.getWebhookPersonality(referencedMessage.id);

      // Check if Redis value is a UUID (new format) vs name (legacy format)
      const isUUID =
        personalityIdOrName !== null &&
        personalityIdOrName !== undefined &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(personalityIdOrName);

      if (isUUID) {
        logger.debug(
          { personalityId: personalityIdOrName },
          '[ReplyResolutionService] Found personality ID in Redis (new format)'
        );
      }

      // Fallback: Parse webhook username if Redis lookup fails or returns legacy name
      if (
        (personalityIdOrName === undefined ||
          personalityIdOrName === null ||
          personalityIdOrName.length === 0) &&
        referencedMessage.author !== undefined &&
        referencedMessage.author !== null
      ) {
        const webhookUsername = referencedMessage.author.username;
        logger.debug(
          { webhookUsername },
          '[ReplyResolutionService] Redis lookup failed, parsing webhook username'
        );

        // Extract personality name by removing bot suffix
        // Format: "Personality | suffix" -> "Personality"
        if (webhookUsername.includes(' | ')) {
          personalityIdOrName = webhookUsername.split(' | ')[0].trim();
          logger.debug(
            { personalityName: personalityIdOrName },
            '[ReplyResolutionService] Extracted personality name from webhook username'
          );
        }
      }

      if (
        personalityIdOrName === undefined ||
        personalityIdOrName === null ||
        personalityIdOrName.length === 0
      ) {
        logger.debug('[ReplyResolutionService] No personality found for webhook message');
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
        { personalityName: personality.displayName, userId },
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
