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
      return false; // Continue chain - let other processors handle it
    }

    // Get voice transcript if available (set by VoiceMessageProcessor earlier in chain)
    const voiceTranscript = VoiceMessageProcessor.getVoiceTranscript(message);
    const content = voiceTranscript ?? message.content;

    // Handle the message with isAutoResponse flag
    // TODO: Thread isAutoResponse through the handler chain (Phase 3 task)
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
