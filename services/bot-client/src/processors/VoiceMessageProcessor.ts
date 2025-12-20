/**
 * Voice Message Processor
 *
 * Handles voice message auto-transcription when enabled.
 * Transcribes voice, sends to Discord, and determines if personality handling should continue.
 */

import type { Message } from 'discord.js';
import { createLogger, getConfig } from '@tzurot/common-types';
import type { IMessageProcessor } from './IMessageProcessor.js';
import { VoiceTranscriptionService } from '../services/VoiceTranscriptionService.js';
import type { IPersonalityLoader } from '../types/IPersonalityLoader.js';
import { findPersonalityMention } from '../utils/personalityMentionParser.js';

const logger = createLogger('VoiceMessageProcessor');

/**
 * Shared context for passing voice transcript to other processors
 * Stored on the message object as a non-enumerable property
 */
const VOICE_TRANSCRIPT_KEY = Symbol('voiceTranscript');

export class VoiceMessageProcessor implements IMessageProcessor {
  constructor(
    private readonly voiceService: VoiceTranscriptionService,
    private readonly personalityService: IPersonalityLoader
  ) {}

  async process(message: Message): Promise<boolean> {
    const config = getConfig();

    // Check if auto-transcription is enabled
    if (config.AUTO_TRANSCRIBE_VOICE !== 'true') {
      return false; // Continue to next processor
    }

    // Check if message has voice attachment
    if (!this.voiceService.hasVoiceAttachment(message)) {
      return false; // Continue to next processor
    }

    logger.debug('[VoiceMessageProcessor] Processing voice message');

    // Check if message also targets a personality
    const isReply = message.reference !== null;
    const mentionCheck = await findPersonalityMention(
      message.content,
      config.BOT_MENTION_CHAR,
      this.personalityService,
      message.author.id
    );
    const hasMention = mentionCheck !== null || message.mentions.has(message.client.user);

    // Transcribe the voice message
    const result = await this.voiceService.transcribe(message, hasMention, isReply);

    if (!result) {
      // Transcription failed, error already sent to user
      return true; // Stop processing
    }

    // Store transcript for other processors to use
    Object.defineProperty(message, VOICE_TRANSCRIPT_KEY, {
      value: result.transcript,
      writable: false,
      enumerable: false,
    });

    // Always continue to next processor after transcription
    // - ReplyMessageProcessor may handle if this is a reply
    // - ActivatedChannelProcessor may handle if channel has activated personality
    // - PersonalityMentionProcessor may handle if there's a personality mention
    // The transcript is stored on the message for later processors to use
    logger.debug(
      { continueToPersonalityHandler: result.continueToPersonalityHandler },
      '[VoiceMessageProcessor] Voice transcription complete, continuing chain'
    );
    return false; // Continue to next processor
  }

  /**
   * Helper to get voice transcript stored by this processor
   * Other processors can use this to get the transcript for personality handling
   */
  static getVoiceTranscript(message: Message): string | undefined {
    return (message as unknown as Record<symbol, string>)[VOICE_TRANSCRIPT_KEY];
  }
}
