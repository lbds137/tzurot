/**
 * Voice Message Processor
 *
 * Handles voice message auto-transcription when enabled via config cascade.
 * Transcribes voice, sends to Discord, and determines if personality handling should continue.
 */

import type { Message } from 'discord.js';
import { createLogger, getConfig, HARDCODED_CONFIG_DEFAULTS } from '@tzurot/common-types';
import type { IMessageProcessor } from './IMessageProcessor.js';
import { VoiceTranscriptionService } from '../services/VoiceTranscriptionService.js';
import type { IPersonalityLoader } from '../types/IPersonalityLoader.js';
import type { GatewayClient } from '../utils/GatewayClient.js';
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
    private readonly personalityService: IPersonalityLoader,
    private readonly gatewayClient: GatewayClient
  ) {}

  async process(message: Message): Promise<boolean> {
    const config = getConfig();

    // Check for voice attachment first (synchronous, cheap) before async gateway call
    if (!this.voiceService.hasVoiceAttachment(message)) {
      return false; // Continue to next processor
    }

    // Check if auto-transcription is enabled via config cascade (admin-level toggle).
    // GatewayClient.getAdminSettings() is TTL-cached (30s), so this is a fast cache hit.
    let voiceTranscriptionEnabled: boolean = HARDCODED_CONFIG_DEFAULTS.voiceTranscriptionEnabled;
    try {
      const adminSettings = await this.gatewayClient.getAdminSettings();
      voiceTranscriptionEnabled =
        adminSettings?.configDefaults?.voiceTranscriptionEnabled ?? voiceTranscriptionEnabled;
    } catch (err) {
      logger.warn(
        { err },
        'Failed to fetch admin settings, using default voice transcription setting'
      );
    }
    if (!voiceTranscriptionEnabled) {
      return false; // Continue to next processor
    }

    logger.debug('Processing voice message');

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

    // Always continue chain after successful transcription — this processor produces
    // the transcript but does NOT decide routing. Downstream processors independently
    // check for personality targeting (replies, activated channels, mentions).
    // continueToPersonalityHandler is logged for observability only.
    logger.debug(
      { continueToPersonalityHandler: result.continueToPersonalityHandler },
      'Voice transcription complete, continuing chain'
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
