/**
 * Voice Transcription Service
 *
 * Handles voice message detection, transcription, and caching.
 * Sends transcription to Discord and stores in Redis for personality processing.
 */

import type { Message } from 'discord.js';
import { GatewayClient } from '../utils/GatewayClient.js';
import { preserveCodeBlocks, createLogger, CONTENT_TYPES } from '@tzurot/common-types';
import { voiceTranscriptCache } from '../redis.js';

const logger = createLogger('VoiceTranscriptionService');

/**
 * Result of voice transcription
 */
export interface VoiceTranscriptionResult {
  /** Transcript text */
  transcript: string;
  /** Whether the message also targets a personality (mention/reply) */
  continueToPersonalityHandler: boolean;
}

/**
 * Handles voice message transcription and caching
 */
export class VoiceTranscriptionService {
  constructor(private readonly gatewayClient: GatewayClient) {}

  /**
   * Check if message contains voice attachment
   */
  hasVoiceAttachment(message: Message): boolean {
    return message.attachments.some(
      a => (a.contentType?.startsWith(CONTENT_TYPES.AUDIO_PREFIX) ?? false) || a.duration !== null
    );
  }

  /**
   * Transcribe voice message and send to Discord
   *
   * @param message - Discord message with voice attachment
   * @param hasMention - Whether message also has personality mention
   * @param isReply - Whether message is a reply
   * @returns Transcript text if successful, undefined on error
   */
  async transcribe(
    message: Message,
    hasMention: boolean,
    isReply: boolean
  ): Promise<VoiceTranscriptionResult | null> {
    try {
      // Show typing indicator (if channel supports it)
      if ('sendTyping' in message.channel) {
        await message.channel.sendTyping();
      }

      // Extract voice attachment metadata
      const attachments = Array.from(message.attachments.values()).map(attachment => ({
        url: attachment.url,
        contentType:
          attachment.contentType !== null &&
          attachment.contentType !== undefined &&
          attachment.contentType.length > 0
            ? attachment.contentType
            : CONTENT_TYPES.BINARY,
        name: attachment.name,
        size: attachment.size,
        isVoiceMessage: attachment.duration !== null,
        duration: attachment.duration ?? undefined,
        waveform: attachment.waveform ?? undefined,
      }));

      // Send transcribe job to api-gateway
      const response = await this.gatewayClient.transcribe(attachments);

      if (!response?.content) {
        throw new Error('No transcript returned from transcription service');
      }

      // Chunk the transcript (respecting 2000 char Discord limit)
      const chunks = preserveCodeBlocks(response.content);

      logger.info(
        `[VoiceTranscriptionService] Transcription complete: ${response.content.length} chars, ${chunks.length} chunks`
      );

      // Send each chunk as a reply (these will appear BEFORE personality webhook response)
      for (const chunk of chunks) {
        await message.reply(chunk);
      }

      // Cache transcript in Redis to avoid re-transcribing if this voice message also targets a personality
      // Key by attachment URL with 5 min TTL (long enough for personality processing)
      const voiceAttachment = attachments[0]; // We know there's at least one
      if (voiceAttachment !== undefined && voiceAttachment !== null) {
        await voiceTranscriptCache.store(voiceAttachment.url, response.content);
        logger.debug(
          `[VoiceTranscriptionService] Cached transcript for attachment: ${voiceAttachment.url.substring(0, 50)}...`
        );
      }

      // Determine if we should continue to personality handler
      const continueToPersonalityHandler = hasMention || isReply;

      if (continueToPersonalityHandler) {
        logger.debug(
          '[VoiceTranscriptionService] Voice message with personality mention/reply - continuing to personality handler'
        );
      }

      return {
        transcript: response.content,
        continueToPersonalityHandler,
      };
    } catch (error) {
      logger.error({ err: error }, '[VoiceTranscriptionService] Error transcribing voice message');
      await message.reply("Sorry, I couldn't transcribe that voice message.").catch(replyError => {
        logger.warn(
          { err: replyError, messageId: message.id },
          '[VoiceTranscriptionService] Failed to send error message to user'
        );
      });
      return null;
    }
  }
}
