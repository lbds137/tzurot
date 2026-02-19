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
import { createLogger } from '@tzurot/common-types';
import type { IMessageProcessor } from './IMessageProcessor.js';
import type { IPersonalityLoader } from '../types/IPersonalityLoader.js';
import { GatewayClient } from '../utils/GatewayClient.js';
import { PersonalityMessageHandler } from '../services/PersonalityMessageHandler.js';
import { VoiceMessageProcessor } from './VoiceMessageProcessor.js';
import { shouldNotifyUser } from './notificationCache.js';
import { getEffectiveContent } from '../utils/messageTypeUtils.js';
import { getThreadParentId } from '../utils/discordChannelTypes.js';

const logger = createLogger('ActivatedChannelProcessor');

export class ActivatedChannelProcessor implements IMessageProcessor {
  constructor(
    private readonly gatewayClient: GatewayClient,
    private readonly personalityService: IPersonalityLoader,
    private readonly personalityHandler: PersonalityMessageHandler
  ) {}

  async process(message: Message): Promise<boolean> {
    const channelId = message.channelId;
    const userId = message.author.id;

    // Check if this channel has an activated personality (thread-specific first, then parent)
    let channelSettings = await this.gatewayClient.getChannelSettings(channelId);

    const hasActivation =
      channelSettings?.hasSettings === true &&
      channelSettings?.settings?.personalitySlug !== undefined &&
      channelSettings.settings.personalitySlug !== null;

    // Fall back to parent channel for threads without their own settings.
    // Only fall back when the thread has NO settings record at all — if it has
    // a record with null activation (explicitly deactivated), respect that.
    if (!hasActivation && channelSettings?.hasSettings !== true) {
      const parentId = getThreadParentId(message.channel);
      if (parentId !== null) {
        channelSettings = await this.gatewayClient.getChannelSettings(parentId);
      }
    }

    if (
      channelSettings?.hasSettings !== true ||
      channelSettings?.settings?.personalitySlug === undefined ||
      channelSettings.settings.personalitySlug === null
    ) {
      return false; // No activation, continue chain
    }

    const { personalitySlug, personalityName } = channelSettings.settings;

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
    // For forwarded messages, getEffectiveContent extracts content from the snapshot
    const voiceTranscript = VoiceMessageProcessor.getVoiceTranscript(message);
    const content = voiceTranscript ?? getEffectiveContent(message);

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
