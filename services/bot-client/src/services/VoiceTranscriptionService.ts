/**
 * Voice Transcription Service
 *
 * Handles voice message detection, transcription, and caching.
 * Sends transcription to Discord and stores in Redis for personality processing.
 */

import type { Message } from 'discord.js';
import { GatewayClient } from '../utils/GatewayClient.js';
import { splitMessage, createLogger, CONTENT_TYPES, isTimeoutError } from '@tzurot/common-types';
import { voiceTranscriptCache } from '../redis.js';
import { hasForwardedSnapshots, getSnapshots } from '../utils/forwardedMessageUtils.js';

const logger = createLogger('VoiceTranscriptionService');

/** Interval for refreshing the typing indicator (Discord expires at ~10s, matches JobTracker.ts) */
const TYPING_INDICATOR_INTERVAL_MS = 8000;

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
    // Skip transcription of bot's own voice messages (e.g., forwarded TTS)
    if (message.author.id === message.client.user?.id) {
      logger.debug('Skipping transcription of bot own message');
      return null;
    }

    let typingInterval: NodeJS.Timeout | undefined;
    try {
      // Show typing indicator (if channel supports it)
      // Refresh every 8s to keep it alive during long transcriptions (Discord expires at ~10s)
      if ('sendTyping' in message.channel) {
        const channel = message.channel;
        await channel.sendTyping();
        typingInterval = setInterval(() => {
          void (channel as { sendTyping: () => Promise<void> }).sendTyping().catch(err => {
            logger.warn({ err }, 'Failed to refresh typing indicator');
          });
        }, TYPING_INDICATOR_INTERVAL_MS);
      }

      // Extract voice attachment metadata from direct attachments (audio-only)
      let attachments = extractAudioFromSnapshot({ attachments: message.attachments });

      // If no direct audio attachments, check forwarded message snapshots
      // Uses centralized utility for consistent forwarded message handling
      if (attachments.length === 0 && hasForwardedSnapshots(message)) {
        const forwardedAudio = extractAudioFromForwardedSnapshots(message);
        if (forwardedAudio.length > 0) {
          attachments = forwardedAudio;
          logger.debug('Found audio in forwarded message snapshot');
        }
      }

      // Send transcribe job to api-gateway (include userId for BYOK key resolution)
      const response = await this.gatewayClient.transcribe(attachments, message.author.id);

      if (!response?.content) {
        throw new Error('No transcript returned from transcription service');
      }

      // Chunk the transcript (respecting 2000 char Discord limit)
      const chunks = splitMessage(response.content);

      logger.info(
        { chars: response.content.length, chunks: chunks.length },
        'Transcription complete'
      );

      // Cache transcript in Redis BEFORE sending Discord replies to prevent race condition
      // If personality processing starts before cache storage completes, it might re-transcribe
      // Key by attachment URL with 5 min TTL (long enough for personality processing)
      const voiceAttachment = attachments[0]; // We know there's at least one
      if (voiceAttachment !== undefined && voiceAttachment !== null) {
        await voiceTranscriptCache.store(voiceAttachment.url, response.content);
        logger.debug(
          { urlPreview: voiceAttachment.url.substring(0, 50) },
          'Cached transcript for attachment'
        );
      }

      // Send each chunk as a reply (these will appear BEFORE personality webhook response)
      // Don't ping the user - they already know they sent a voice message
      for (const chunk of chunks) {
        await message.reply({
          content: chunk,
          allowedMentions: { parse: [], repliedUser: false },
        });
      }

      // Determine if we should continue to personality handler
      const continueToPersonalityHandler = hasMention || isReply;

      if (continueToPersonalityHandler) {
        logger.debug(
          'Voice message with personality mention/reply - continuing to personality handler'
        );
      }

      return {
        transcript: response.content,
        continueToPersonalityHandler,
      };
    } catch (error) {
      logger.error({ err: error }, 'Error transcribing voice message');

      const userMessage = isTimeoutError(error)
        ? 'Sorry, transcription is taking too long \u2014 the voice service may be starting up. Please try again in a moment.'
        : "Sorry, I couldn't transcribe that voice message.";

      await message
        .reply({
          content: userMessage,
          allowedMentions: { parse: [], repliedUser: false },
        })
        .catch(replyError => {
          logger.warn(
            { err: replyError, messageId: message.id },
            'Failed to send error message to user'
          );
        });
      return null;
    } finally {
      if (typingInterval !== undefined) {
        clearInterval(typingInterval);
      }
    }
  }
}
