/**
 * Bot Mention Processor
 *
 * Handles generic bot mentions (not a specific personality).
 * Uses the default personality if configured.
 * Last processor in the chain - fallback for unhandled mentions.
 */

import type { Message } from 'discord.js';
import { PersonalityService, createLogger } from '@tzurot/common-types';
import type { IMessageProcessor } from './IMessageProcessor.js';
import { PersonalityMessageHandler } from '../services/PersonalityMessageHandler.js';
import { VoiceMessageProcessor } from './VoiceMessageProcessor.js';

const logger = createLogger('BotMentionProcessor');

export class BotMentionProcessor implements IMessageProcessor {
  constructor(
    private readonly personalityService: PersonalityService,
    private readonly personalityHandler: PersonalityMessageHandler
  ) {}

  async process(message: Message): Promise<boolean> {
    // Check for generic bot mention
    if (!message.mentions.has(message.client.user)) {
      return false; // No bot mention, message is unhandled
    }

    logger.debug('[BotMentionProcessor] Processing generic bot mention');

    // Load default personality
    const defaultPersonality = await this.personalityService.loadPersonality('default');

    if (!defaultPersonality) {
      logger.warn({}, '[BotMentionProcessor] Default personality not configured');
      return false; // No default personality, message is unhandled
    }

    // Clean Discord mention tags from content
    const cleanContent = message.content.replace(/<@!?\d+>/g, '').trim();

    // Get voice transcript if available (set by VoiceMessageProcessor)
    const voiceTranscript = VoiceMessageProcessor.getVoiceTranscript(message);
    const content = voiceTranscript || cleanContent;

    // Handle the personality message
    await this.personalityHandler.handleMessage(message, defaultPersonality, content);

    return true; // Stop processing (mention was handled)
  }
}
