/**
 * Voice Transcription Service
 *
 * Handles voice message detection, transcription, and caching.
 * Sends transcription to Discord and stores in Redis for personality processing.
 */

import type { Message } from 'discord.js';
import { GatewayClient } from '../utils/GatewayClient.js';
import { splitMessage, createLogger, CONTENT_TYPES } from '@tzurot/common-types';
import { voiceTranscriptCache } from '../redis.js';
import { hasForwardedSnapshots, getSnapshots } from '../utils/forwardedMessageUtils.js';

const logger = createLogger('VoiceTranscriptionService');

/** Attachment info for transcription */
interface TranscriptionAttachment {
  url: string;
  contentType: string;
  name: string;
  size: number;
  isVoiceMessage: boolean;
  duration: number | undefined;
  waveform: string | undefined;
}

/**
 * Extract audio attachments from a message snapshot
 * @internal
 */
function extractAudioFromSnapshot(snapshot: {
  attachments?: ReadonlyMap<
    string,
    {
      url: string;
      contentType: string | null;
      name: string;
      size: number;
      duration: number | null;
      waveform?: string | null;
    }
  > | null;
}): TranscriptionAttachment[] {
  if (!snapshot.attachments || snapshot.attachments.size === 0) {
    return [];
  }

  return Array.from(snapshot.attachments.values())
    .filter(
      a => (a.contentType?.startsWith(CONTENT_TYPES.AUDIO_PREFIX) ?? false) || a.duration !== null
    )
    .map(attachment => ({
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
}

/**
 * Check if a snapshot has any audio attachments
 * @internal
 */
function snapshotHasAudio(snapshot: {
  attachments?: ReadonlyMap<
    string,
    {
      contentType: string | null;
      duration: number | null;
    }
  > | null;
}): boolean {
  if (!snapshot.attachments || snapshot.attachments.size === 0) {
    return false;
  }

  return Array.from(snapshot.attachments.values()).some(
    a => (a.contentType?.startsWith(CONTENT_TYPES.AUDIO_PREFIX) ?? false) || a.duration !== null
  );
}

/**
 * Extract audio attachments from forwarded message snapshots
 * @internal
 */
function extractAudioFromForwardedSnapshots(message: Message): TranscriptionAttachment[] {
  const snapshots = getSnapshots(message);
  if (snapshots === undefined) {
    return [];
  }

  for (const snapshot of snapshots.values()) {
    const snapshotAttachments = extractAudioFromSnapshot(snapshot);
    if (snapshotAttachments.length > 0) {
      return snapshotAttachments; // Return first snapshot with audio
    }
  }

  return [];
}

/**
 * Result of voice transcription
 */
interface VoiceTranscriptionResult {
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
   * Check if message contains voice attachment (in direct attachments or forwarded message snapshots)
   * Uses centralized utilities from forwardedMessageUtils.ts for consistent forwarded message handling.
   */
  hasVoiceAttachment(message: Message): boolean {
    // Check direct attachments
    const hasDirectAudio = message.attachments.some(
      a => (a.contentType?.startsWith(CONTENT_TYPES.AUDIO_PREFIX) ?? false) || a.duration !== null
    );

    if (hasDirectAudio) {
      return true;
    }

    // Check forwarded message snapshots using centralized utility
    if (!hasForwardedSnapshots(message)) {
      return false;
    }

    const snapshots = getSnapshots(message);
    if (snapshots === undefined) {
      return false;
    }

    for (const snapshot of snapshots.values()) {
      if (snapshotHasAudio(snapshot)) {
        return true;
      }
    }

    return false;
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

      // Extract voice attachment metadata from direct attachments
      let attachments = Array.from(message.attachments.values()).map(attachment => ({
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

      // If no direct audio attachments, check forwarded message snapshots
      // Uses centralized utility for consistent forwarded message handling
      if (attachments.length === 0 && hasForwardedSnapshots(message)) {
        const forwardedAudio = extractAudioFromForwardedSnapshots(message);
        if (forwardedAudio.length > 0) {
          attachments = forwardedAudio;
          logger.debug('[VoiceTranscriptionService] Found audio in forwarded message snapshot');
        }
      }

      // Send transcribe job to api-gateway
      const response = await this.gatewayClient.transcribe(attachments);

      if (!response?.content) {
        throw new Error('No transcript returned from transcription service');
      }

      // Chunk the transcript (respecting 2000 char Discord limit)
      const chunks = splitMessage(response.content);

      logger.info(
        `[VoiceTranscriptionService] Transcription complete: ${response.content.length} chars, ${chunks.length} chunks`
      );

      // Cache transcript in Redis BEFORE sending Discord replies to prevent race condition
      // If personality processing starts before cache storage completes, it might re-transcribe
      // Key by attachment URL with 5 min TTL (long enough for personality processing)
      const voiceAttachment = attachments[0]; // We know there's at least one
      if (voiceAttachment !== undefined && voiceAttachment !== null) {
        await voiceTranscriptCache.store(voiceAttachment.url, response.content);
        logger.debug(
          `[VoiceTranscriptionService] Cached transcript for attachment: ${voiceAttachment.url.substring(0, 50)}...`
        );
      }

      // Send each chunk as a reply (these will appear BEFORE personality webhook response)
      // Don't ping the user - they already know they sent a voice message
      for (const chunk of chunks) {
        await message.reply({ content: chunk, allowedMentions: { repliedUser: false } });
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
      await message
        .reply({
          content: "Sorry, I couldn't transcribe that voice message.",
          allowedMentions: { repliedUser: false },
        })
        .catch(replyError => {
          logger.warn(
            { err: replyError, messageId: message.id },
            '[VoiceTranscriptionService] Failed to send error message to user'
          );
        });
      return null;
    }
  }
}
