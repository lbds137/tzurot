/**
 * Reply Resolution Service
 *
 * Resolves which personality a reply is targeting by examining the replied-to message.
 * Handles webhook detection (guild channels), bot message detection (DMs),
 * personality lookup, and cross-instance filtering.
 *
 * Lookup Strategy (Tiered):
 * 1. Redis (fast path) - 7-day TTL, stores personality ID directly
 * 2. Database (authoritative) - Query by Discord message ID via api-gateway.
 *    Runs in both DMs and guild channels; covers the Redis-evicted case
 *    (messages older than 7 days, or transient store failure during the
 *    original send).
 * 3. Display name parsing (last resort) - Parse **Name:** prefix (DMs) or
 *    strip the canonical bot suffix off the webhook username (guilds). The
 *    suffix is derived from `client.user.tag` via `deriveBotSuffix`, so the
 *    parser stays in sync with the suffix WebhookManager emits.
 */

import { ChannelType, type Message } from 'discord.js';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { isUuidFormat } from '@tzurot/common-types/utils/deterministicUuid';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { IPersonalityLoader } from '../types/IPersonalityLoader.js';
import { lookupPersonalityFromMessage } from '../utils/gatewayServiceCalls.js';
import { redisService } from '../redis.js';
import { deriveBotSuffix, stripBotSuffix } from '../utils/webhookNaming.js';

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
  constructor(private readonly personalityService: IPersonalityLoader) {}

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
        logger.debug('Reply in DM is not to a bot message, skipping');
        return false;
      }
      logger.debug('DM reply to bot message detected');
      return true;
    }

    // Guild: require webhookId (personality messages are sent via webhooks)
    if (!isValidIdentifier(referencedMessage.webhookId)) {
      logger.debug('Reply is to a non-webhook message, skipping');
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
        'Ignoring reply to webhook from different bot instance'
      );
      return false;
    }

    return true;
  }

  /**
   * Parse personality name from message content (DM) or webhook username (guild).
   * Tier 3 fallback — purely for user convenience, not security-dependent.
   *
   * @param botTag - The running bot's `client.user.tag`. Used to derive the
   *   canonical webhook suffix for guild webhook-username parsing. Passed in
   *   explicitly (rather than read from `referencedMessage.client`) because
   *   the caller already has access to the original message's client and
   *   threading it down keeps the dependency explicit + test-friendly.
   */
  private parseDisplayName(
    referencedMessage: Message,
    isDM: boolean,
    botTag: string | null
  ): string | null {
    if (isDM && referencedMessage.content) {
      // DM format: **DisplayName:** message content
      const prefixMatch = /^\*\*([^:\n]+?):\*\*/.exec(referencedMessage.content);
      if (prefixMatch) {
        logger.debug(
          { displayName: prefixMatch[1] },
          'Parsed display name from DM message prefix (tier 3)'
        );
        return prefixMatch[1];
      }
    } else if (
      !isDM &&
      referencedMessage.author !== undefined &&
      referencedMessage.author !== null
    ) {
      // Guild format: webhook username is `${personality.displayName}${botSuffix}`.
      // Derive the suffix from the running bot's tag (rather than scanning
      // for a hardcoded separator) so the parser stays correct even if the
      // separator changes again; `stripBotSuffix` also falls back to the
      // legacy ` | BotName` form for messages sent before the separator
      // was switched.
      const webhookUsername = referencedMessage.author.username;
      const botSuffix = deriveBotSuffix(botTag);
      const name = botSuffix.length > 0 ? stripBotSuffix(webhookUsername, botSuffix) : null;
      if (name !== null) {
        logger.debug(
          { personalityName: name },
          'Extracted personality name from webhook username (tier 3)'
        );
        return name;
      }
    }
    return null;
  }

  /**
   * Multi-tier personality identifier lookup:
   * Tier 1: Redis (fast path), Tier 2: Database (DMs and guilds — covers
   * Redis-evicted/never-stored cases), Tier 3: Display name parsing
   */
  private async lookupPersonalityIdentifier(
    referencedMessage: Message,
    isDM: boolean,
    botTag: string | null
  ): Promise<string | null> {
    // Tier 1: Redis (fast path for recent messages)
    let identifier = await redisService.getWebhookPersonality(referencedMessage.id);

    if (isValidIdentifier(identifier) && isUuidFormat(identifier)) {
      logger.debug({ personalityId: identifier }, 'Found personality ID in Redis (tier 1)');
    }

    // Tier 2: Database lookup when Redis misses. Runs in both DMs and guild
    // channels — `lookupPersonalityFromConversation` is a generic query by
    // `discordMessageId`, not DM-specific. Critical for guild channels where
    // tier 3 webhook-username parsing is best-effort: in an activated channel
    // where the user direct-replies to a personality whose Redis key has
    // expired (>7d) or was never stored (transient failure), tier 2 is what
    // keeps the reply slot populated and preserves slot-0 ordering in
    // multi-tag fan-outs.
    if (!isValidIdentifier(identifier)) {
      const dbResult = await lookupPersonalityFromMessage(referencedMessage.id);
      if (dbResult !== null) {
        identifier = dbResult.personalityId;
        logger.debug(
          { personalityId: identifier, isDM },
          'Found personality via database lookup (tier 2)'
        );
      }
    }

    // Tier 3: Display name parsing (last resort)
    if (!isValidIdentifier(identifier)) {
      identifier = this.parseDisplayName(referencedMessage, isDM, botTag);
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
        logger.warn('Called with message that has no reference');
        return null;
      }

      const referencedMessage = await message.channel.messages.fetch(messageId);
      const isDM = message.channel.type === ChannelType.DM;

      if (!this.validateReferencedMessage(referencedMessage, message.client.user?.id ?? '', isDM)) {
        return null;
      }

      const personalityIdOrName = await this.lookupPersonalityIdentifier(
        referencedMessage,
        isDM,
        message.client.user?.tag ?? null
      );
      if (personalityIdOrName === null) {
        logger.debug('No personality found for replied message');
        return null;
      }

      // Load with access control — prevents the "Reply Loophole"
      const personality = await this.personalityService.loadPersonality(
        personalityIdOrName,
        userId
      );

      if (!personality) {
        logger.debug({ personalityIdOrName, userId }, 'Personality not found or access denied');
        return null;
      }

      logger.info(
        { personalityName: personality.displayName, userId, isDM },
        'Resolved personality from reply'
      );

      return personality;
    } catch (error) {
      if (isExpectedDiscordError(error)) {
        logger.debug({ err: error }, 'Referenced message was deleted');
      } else {
        logger.warn({ err: error }, 'Unexpected error fetching or processing referenced message');
      }
      return null;
    }
  }
}
