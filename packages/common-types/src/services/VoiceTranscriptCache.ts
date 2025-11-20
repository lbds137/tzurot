/**
 * VoiceTranscriptCache
 * Shared service for caching voice transcripts across services
 *
 * Used by:
 * - bot-client: Stores transcripts after transcription
 * - ai-worker: Reads transcripts to avoid re-transcribing
 */

import type { RedisClientType } from 'redis';
import { createLogger } from '../utils/logger.js';
import { REDIS_KEY_PREFIXES, INTERVALS } from '../constants/index.js';

const logger = createLogger('VoiceTranscriptCache');

export class VoiceTranscriptCache {
  constructor(private redis: RedisClientType) {}

  /**
   * Store voice transcript in cache
   * @param attachmentUrl Discord CDN attachment URL (originalUrl)
   * @param transcript Transcribed text
   * @param ttlSeconds Time to live in seconds (default: 5 minutes)
   */
  async store(
    attachmentUrl: string,
    transcript: string,
    ttlSeconds: number = INTERVALS.VOICE_TRANSCRIPT_TTL
  ): Promise<void> {
    try {
      await this.redis.setEx(
        `${REDIS_KEY_PREFIXES.VOICE_TRANSCRIPT}${attachmentUrl}`,
        ttlSeconds,
        transcript
      );
      logger.debug(
        `[VoiceTranscriptCache] Stored transcript for: ${attachmentUrl.substring(0, 50)}...`
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
      const transcript = await this.redis.get(
        `${REDIS_KEY_PREFIXES.VOICE_TRANSCRIPT}${attachmentUrl}`
      );

      if (transcript !== null && transcript.length > 0) {
        logger.debug(`[VoiceTranscriptCache] Cache HIT for: ${attachmentUrl.substring(0, 50)}...`);
        return transcript;
      }

      logger.debug(`[VoiceTranscriptCache] Cache MISS for: ${attachmentUrl.substring(0, 50)}...`);
      return null;
    } catch (error) {
      logger.error({ err: error }, '[VoiceTranscriptCache] Failed to get transcript');
      return null;
    }
  }
}
