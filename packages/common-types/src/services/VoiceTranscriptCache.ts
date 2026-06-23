/**
 * VoiceTranscriptCache
 * Shared service for caching voice transcripts across services
 *
 * Used by:
 * - bot-client: Stores transcripts after transcription
 * - ai-worker: Reads transcripts to avoid re-transcribing
 */

import type { Redis } from 'ioredis';
import { createLogger } from '../utils/logger.js';
import { deriveAttachmentCacheKey } from '../utils/attachmentCacheKey.js';
import { REDIS_KEY_PREFIXES, INTERVALS } from '../constants/index.js';

const logger = createLogger('VoiceTranscriptCache');

export class VoiceTranscriptCache {
  constructor(private redis: Redis) {}

  /**
   * Derive the stable Redis key for an attachment URL. Strips the volatile
   * Discord CDN signature query (`?ex=&is=&hs=`) so the same audio resolves to
   * one key across re-fetches — otherwise every re-signed URL was a cache miss.
   * Voice supplies no attachment id store-side, so this always takes the
   * query-stripped url-hash branch (the path embeds the immutable attachment id).
   */
  private keyFor(attachmentUrl: string): string {
    return deriveAttachmentCacheKey(REDIS_KEY_PREFIXES.VOICE_TRANSCRIPT, { url: attachmentUrl });
  }

  /**
   * Store voice transcript in cache
   * @param attachmentUrl Discord CDN attachment URL (originalUrl)
   * @param transcript Transcribed text
   * @param ttlSeconds Time to live in seconds (default: VOICE_TRANSCRIPT_TTL, 1 hour)
   */
  async store(
    attachmentUrl: string,
    transcript: string,
    ttlSeconds: number = INTERVALS.VOICE_TRANSCRIPT_TTL
  ): Promise<void> {
    try {
      // ioredis uses lowercase method names: setex instead of setEx
      await this.redis.setex(this.keyFor(attachmentUrl), ttlSeconds, transcript);
      logger.debug(
        { urlPreview: attachmentUrl.substring(0, 50) },
        '[VoiceTranscriptCache] Stored transcript'
      );
    } catch (error) {
      logger.error({ err: error }, '[VoiceTranscriptCache] Failed to store transcript');
    }
  }

  /**
   * Get cached voice transcript
   * @param attachmentUrl Discord CDN attachment URL (originalUrl)
   * @returns Transcript text or null if not found
   */
  async get(attachmentUrl: string): Promise<string | null> {
    try {
      const transcript = await this.redis.get(this.keyFor(attachmentUrl));

      if (transcript !== null && transcript.length > 0) {
        logger.debug(
          { urlPreview: attachmentUrl.substring(0, 50) },
          '[VoiceTranscriptCache] Cache HIT'
        );
        return transcript;
      }

      logger.debug(
        { urlPreview: attachmentUrl.substring(0, 50) },
        '[VoiceTranscriptCache] Cache MISS'
      );
      return null;
    } catch (error) {
      logger.error({ err: error }, '[VoiceTranscriptCache] Failed to get transcript');
      return null;
    }
  }
}
