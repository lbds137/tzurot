/**
 * Personality Mention Processor
 *
 * Handles explicit personality mentions (e.g., "@personality hello").
 * Uses the configured mention character (default: @).
 */

import type { Message } from 'discord.js';
import { createLogger, getConfig } from '@tzurot/common-types';
import type { IMessageProcessor } from './IMessageProcessor.js';
import type { IPersonalityLoader } from '../types/IPersonalityLoader.js';
import { PersonalityMessageHandler } from '../services/PersonalityMessageHandler.js';
import { findPersonalityMention } from '../utils/personalityMentionParser.js';
import { VoiceMessageProcessor } from './VoiceMessageProcessor.js';

const logger = createLogger('PersonalityMentionProcessor');

export class PersonalityMentionProcessor implements IMessageProcessor {
  constructor(
    private readonly personalityService: IPersonalityLoader,
    private readonly personalityHandler: PersonalityMessageHandler
  ) {}

  async process(message: Message): Promise<boolean> {
    // Check for personality mentions (e.g., "@personality hello")
    // Pass userId for access control - only matches accessible personalities
    const config = getConfig();
    const userId = message.author.id;
    const mentionMatch = await findPersonalityMention(
      message.content,
      config.BOT_MENTION_CHAR,
      this.personalityService,
      userId
    );

    if (!mentionMatch) {
      return false; // No personality mention, continue to next processor
    }

    logger.debug(
      { personalityName: mentionMatch.personalityName, userId },
      '[PersonalityMentionProcessor] Processing personality mention'
    );

    // Load personality from database (PersonalityService has internal cache)
    // Access control already applied in findPersonalityMention, but we load with userId
    // to ensure consistency and get the full personality object
    const personality = await this.personalityService.loadPersonality(
      mentionMatch.personalityName,
      userId
    );

    if (!personality) {
      // Unknown personality or no access - silently ignore
      logger.debug(
        { personalityName: mentionMatch.personalityName, userId },
        '[PersonalityMentionProcessor] Personality not found or access denied'
      );
      return false; // Continue to next processor
    }

    // Get voice transcript if available (set by VoiceMessageProcessor)
    const voiceTranscript = VoiceMessageProcessor.getVoiceTranscript(message);
    const content = voiceTranscript ?? mentionMatch.cleanContent;

    // Handle the personality message
    await this.personalityHandler.handleMessage(message, personality, content);

    return true; // Stop processing (mention was handled)
  }
}
