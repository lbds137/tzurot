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
import { getEffectiveContent } from '../utils/messageTypeUtils.js';
import { isForwardedMessage } from '../utils/forwardedMessageUtils.js';

const logger = createLogger('PersonalityMentionProcessor');

export class PersonalityMentionProcessor implements IMessageProcessor {
  constructor(
    private readonly personalityService: IPersonalityLoader,
    private readonly personalityHandler: PersonalityMessageHandler
  ) {}

  async process(message: Message): Promise<boolean> {
    // Forwarded messages are referential ("look at this"), not invocational.
    // A forwarded message containing @PersonalityName should not trigger AI.
    if (isForwardedMessage(message)) {
      logger.debug({ messageId: message.id }, 'Skipping forwarded message');
      return false;
    }

    // Check for personality mentions (e.g., "@personality hello")
    // Pass userId for access control - only matches accessible personalities
    const config = getConfig();
    const userId = message.author.id;
    const effectiveContent = getEffectiveContent(message);
    const mentionMatch = await findPersonalityMention(
      effectiveContent,
      config.BOT_MENTION_CHAR,
      this.personalityService,
      userId
    );

    if (!mentionMatch) {
      return false; // No personality mention, continue to next processor
    }

    logger.debug(
      { personalityName: mentionMatch.personalityName, userId },
      'Processing personality mention'
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
        'Personality not found or access denied'
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
