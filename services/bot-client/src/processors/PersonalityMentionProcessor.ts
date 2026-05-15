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
import { findPersonalityMentions } from '../utils/personalityMentionParser.js';
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

    // Check for personality mentions (e.g., "@personality hello").
    // Multi-tag note: this processor is interim — PersonalityTriggerProcessor
    // (added in the same PR) consolidates reply + mention + activation routing
    // and supports fan-out. For now, we take the first mention only to keep
    // single-personality semantics during the foundation checkpoint.
    const config = getConfig();
    const userId = message.author.id;
    const effectiveContent = getEffectiveContent(message);
    const matches = await findPersonalityMentions(
      effectiveContent,
      config.BOT_MENTION_CHAR,
      this.personalityService,
      userId,
      1
    );

    const firstMatch = matches[0];
    if (firstMatch === undefined) {
      return false; // No personality mention, continue to next processor
    }

    logger.debug(
      { personalityName: firstMatch.personality.name, userId },
      'Processing personality mention'
    );

    // Get voice transcript if available (set by VoiceMessageProcessor).
    // We pass raw effective content (no cleanContent stripping) — per the
    // multi-tag design, the persona's system prompt establishes identity
    // and modern LLMs handle @-syntax naturally.
    const voiceTranscript = VoiceMessageProcessor.getVoiceTranscript(message);
    const content = voiceTranscript ?? effectiveContent;

    // Handle the personality message
    await this.personalityHandler.handleMessage(message, firstMatch.personality, content);

    return true; // Stop processing (mention was handled)
  }
}
