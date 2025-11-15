/**
 * Personality Mention Processor
 *
 * Handles explicit personality mentions (e.g., "@personality hello").
 * Uses the configured mention character (default: @).
 */

import type { Message } from 'discord.js';
import { PersonalityService, createLogger, getConfig } from '@tzurot/common-types';
import type { IMessageProcessor } from './IMessageProcessor.js';
import { PersonalityMessageHandler } from '../services/PersonalityMessageHandler.js';
import { findPersonalityMention } from '../utils/personalityMentionParser.js';
import { VoiceMessageProcessor } from './VoiceMessageProcessor.js';

const logger = createLogger('PersonalityMentionProcessor');

export class PersonalityMentionProcessor implements IMessageProcessor {
  constructor(
    private readonly personalityService: PersonalityService,
    private readonly personalityHandler: PersonalityMessageHandler
  ) {}

  async process(message: Message): Promise<boolean> {
    // Check for personality mentions (e.g., "@personality hello")
    const config = getConfig();
    const mentionMatch = await findPersonalityMention(
      message.content,
      config.BOT_MENTION_CHAR,
      this.personalityService
    );

    if (!mentionMatch) {
      return false; // No personality mention, continue to next processor
    }

    logger.debug(
      { personalityName: mentionMatch.personalityName },
      '[PersonalityMentionProcessor] Processing personality mention'
    );

    // Load personality from database (PersonalityService has internal cache)
    const personality = await this.personalityService.loadPersonality(
      mentionMatch.personalityName
    );

    if (!personality) {
      // Unknown personality - silently ignore (likely typo or non-bot mention)
      logger.debug(
        { personalityName: mentionMatch.personalityName },
        '[PersonalityMentionProcessor] Unknown personality mentioned'
      );
      return false; // Continue to next processor
    }

    // Get voice transcript if available (set by VoiceMessageProcessor)
    const voiceTranscript = VoiceMessageProcessor.getVoiceTranscript(message);
    const content = voiceTranscript || mentionMatch.cleanContent;

    // Handle the personality message
    await this.personalityHandler.handleMessage(message, personality, content);

    return true; // Stop processing (mention was handled)
  }
}
