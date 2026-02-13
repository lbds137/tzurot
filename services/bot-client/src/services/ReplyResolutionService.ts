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
import { createLogger, isUuidFormat } from '@tzurot/common-types';
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
 * Check if an error is an expected Discord error (e.g., deleted message)
 * DiscordAPIError with code 10008 = Unknown Message (deleted)
 */
function isExpectedDiscordError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as { code: unknown }).code === 10008;
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
   * Validate that the replied-to message is from a personality.
   * In DMs: must be from the bot. In guilds: must be from a webhook owned by this bot instance.
   * @returns true if valid personality message, false if should skip
   */
  private validateReferencedMessage(
    referencedMessage: Message,
    clientUserId: string,
    isDM: boolean
  ): boolean {
    if (isDM) {
      if (referencedMessage.author?.id !== clientUserId) {
        logger.debug('[ReplyResolutionService] Reply in DM is not to a bot message, skipping');
        return false;
      }
      logger.debug('[ReplyResolutionService] DM reply to bot message detected');
      return true;
    }

    // Guild: require webhookId (personality messages are sent via webhooks)
    if (!isValidIdentifier(referencedMessage.webhookId)) {
      logger.debug('[ReplyResolutionService] Reply is to a non-webhook message, skipping');
      return false;
    }

    // Check cross-instance: prevent both dev and prod bots from responding
    if (
      isValidIdentifier(referencedMessage.applicationId) &&
      referencedMessage.applicationId !== clientUserId
    ) {
      logger.debug(
        {
          webhookApplicationId: referencedMessage.applicationId,
          currentBotId: clientUserId,
        },
        '[ReplyResolutionService] Ignoring reply to webhook from different bot instance'
      );
      return false;
    }

    return true;
  }

  /**
   * Parse personality name from message content (DM) or webhook username (guild).
   * Tier 3 fallback — purely for user convenience, not security-dependent.
   */
  private parseDisplayName(referencedMessage: Message, isDM: boolean): string | null {
    if (isDM && referencedMessage.content) {
      // DM format: **DisplayName:** message content
      const prefixMatch = /^\*\*([^:\n]+?):\*\*/.exec(referencedMessage.content);
      if (prefixMatch) {
        logger.debug(
          { displayName: prefixMatch[1] },
          '[ReplyResolutionService] Parsed display name from DM message prefix (tier 3)'
        );
        return prefixMatch[1];
      }
    } else if (
      !isDM &&
      referencedMessage.author !== undefined &&
      referencedMessage.author !== null
    ) {
      // Guild format: Webhook username is "DisplayName | BotName"
      const webhookUsername = referencedMessage.author.username;
      if (webhookUsername.includes(' | ')) {
        const name = webhookUsername.split(' | ')[0].trim();
        logger.debug(
          { personalityName: name },
          '[ReplyResolutionService] Extracted personality name from webhook username (tier 3)'
        );
        return name;
      }
    }
    return null;
  }

  /**
   * Multi-tier personality identifier lookup:
   * Tier 1: Redis (fast path), Tier 2: Database (DM only), Tier 3: Display name parsing
   */
  private async lookupPersonalityIdentifier(
    referencedMessage: Message,
    isDM: boolean
  ): Promise<string | null> {
    // Tier 1: Redis (fast path for recent messages)
    let identifier = await redisService.getWebhookPersonality(referencedMessage.id);

    if (isValidIdentifier(identifier) && isUuidFormat(identifier)) {
      logger.debug(
        { personalityId: identifier },
        '[ReplyResolutionService] Found personality ID in Redis (tier 1)'
      );
    }

    // Tier 2: Database lookup (DM only when Redis misses)
    if (!isValidIdentifier(identifier) && isDM && this.gatewayClient !== undefined) {
      const dbResult = await this.gatewayClient.lookupPersonalityFromConversation(
        referencedMessage.id
      );
      if (dbResult !== null) {
        identifier = dbResult.personalityId;
        logger.debug(
          { personalityId: identifier },
          '[ReplyResolutionService] Found personality via database lookup (tier 2)'
        );
      }
    }

    // Tier 3: Display name parsing (last resort)
    if (!isValidIdentifier(identifier)) {
      identifier = this.parseDisplayName(referencedMessage, isDM);
    }

    return isValidIdentifier(identifier) ? identifier : null;
  }

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
  async resolvePersonality(message: Message, userId: string): Promise<LoadedPersonality | null> {
    try {
      const messageId = message.reference?.messageId;
      if (!isValidIdentifier(messageId)) {
        logger.warn({}, '[ReplyResolutionService] Called with message that has no reference');
        return null;
      }

      const referencedMessage = await message.channel.messages.fetch(messageId);
      const isDM = message.channel.type === ChannelType.DM;

      if (!this.validateReferencedMessage(referencedMessage, message.client.user?.id ?? '', isDM)) {
        return null;
      }

      const personalityIdOrName = await this.lookupPersonalityIdentifier(referencedMessage, isDM);
      if (personalityIdOrName === null) {
        logger.debug('[ReplyResolutionService] No personality found for replied message');
        return null;
      }

      // Load with access control — prevents the "Reply Loophole"
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
      if (isExpectedDiscordError(error)) {
        logger.debug({ err: error }, '[ReplyResolutionService] Referenced message was deleted');
      } else {
        logger.warn(
          { err: error },
          '[ReplyResolutionService] Unexpected error fetching or processing referenced message'
        );
      }
      return null;
    }
  }
}
