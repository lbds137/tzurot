/**
 * Reply Resolution Service
 *
 * Resolves which personality a reply is targeting by examining the replied-to message.
 * Handles webhook detection, personality lookup, and cross-instance filtering.
 */

import type { Message } from 'discord.js';
import { PersonalityService, createLogger } from '@tzurot/common-types';
import type { LoadedPersonality } from '@tzurot/common-types';
import { getWebhookPersonality } from '../redis.js';

const logger = createLogger('ReplyResolutionService');

/**
 * Resolves personality from replied-to messages
 */
export class ReplyResolutionService {
  constructor(private readonly personalityService: PersonalityService) {}

  /**
   * Resolve which personality a reply is targeting
   *
   * @param message - Message that is a reply (message.reference must not be null)
   * @returns LoadedPersonality if reply targets a known personality, null otherwise
   */
  async resolvePersonality(message: Message): Promise<LoadedPersonality | null> {
    try {
      if (!message.reference?.messageId) {
        logger.warn('[ReplyResolutionService] Called with message that has no reference');
        return null;
      }

      // Fetch the message being replied to
      const referencedMessage = await message.channel.messages.fetch(message.reference.messageId);

      // Check if it's from a webhook (personality message)
      if (!referencedMessage.webhookId) {
        logger.debug('[ReplyResolutionService] Reply is to a non-webhook message, skipping');
        return null;
      }

      // Check if this webhook belongs to the current bot instance
      // This prevents both dev and prod bots from responding to the same personality webhook
      if (
        referencedMessage.applicationId &&
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
      let personalityName = await getWebhookPersonality(referencedMessage.id);

      // Fallback: Parse webhook username if Redis lookup fails
      if (!personalityName && referencedMessage.author) {
        const webhookUsername = referencedMessage.author.username;
        logger.debug(
          { webhookUsername },
          '[ReplyResolutionService] Redis lookup failed, parsing webhook username'
        );

        // Extract personality name by removing bot suffix
        // Format: "Personality | suffix" -> "Personality"
        if (webhookUsername.includes(' | ')) {
          personalityName = webhookUsername.split(' | ')[0].trim();
          logger.debug(
            { personalityName },
            '[ReplyResolutionService] Extracted personality name from webhook username'
          );
        }
      }

      if (!personalityName) {
        logger.debug('[ReplyResolutionService] No personality found for webhook message');
        return null;
      }

      // Load the personality from database
      const personality = await this.personalityService.loadPersonality(personalityName);

      if (!personality) {
        logger.warn(
          { personalityName },
          '[ReplyResolutionService] Personality not found in database'
        );
        return null;
      }

      logger.info(
        { personalityName: personality.displayName },
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
