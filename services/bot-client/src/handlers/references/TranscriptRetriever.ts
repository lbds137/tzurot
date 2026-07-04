/**
 * Transcript Retriever
 *
 * Resolves voice-message transcripts from the shared Redis cache ONLY. bot-client
 * must not touch Prisma, so there is no DB tier here — the worker owns the DB.
 *
 * Coverage is split by path, and the split is intentional:
 * - Reference messages (replies / links): the worker re-derives their transcripts
 *   from its own DB tier (`getMessageByDiscordId`), so the reference path stays
 *   fully covered regardless of this cache.
 * - Extended-context messages (room awareness): the worker trusts the transcripts
 *   bot-client ships. A voice message whose transcript has aged out of the Redis
 *   cache (5-min TTL) therefore ships without its text — an accepted divergence
 *   that mirrors the worker's reference path, which is likewise DB-tier-only with
 *   no Redis equivalent.
 *
 * If aged-out extended-context transcripts ever measurably degrade room awareness,
 * the fix is the envelope flat-list pattern (mirroring `rawExtendedContextImageAttachments`):
 * ship the voice-message ids and let the worker batch-re-derive them via its DB
 * tier — no per-message wire mutation and still zero Prisma in bot-client.
 */

import { createLogger } from '@tzurot/common-types/utils/logger';
import { voiceTranscriptCache } from '../../redis.js';

const logger = createLogger('TranscriptRetriever');

/**
 * Service for retrieving voice message transcripts from the shared Redis cache.
 */
export class TranscriptRetriever {
  /**
   * Retrieve a voice transcript from the shared Redis cache.
   * @param discordMessageId - Discord message ID (correlation/logging only)
   * @param attachmentUrl - URL of the voice attachment (the cache key)
   * @returns Transcript text or null if not cached
   */
  async retrieveTranscript(
    discordMessageId: string,
    attachmentUrl: string
  ): Promise<string | null> {
    try {
      const cachedTranscript = await voiceTranscriptCache.get(attachmentUrl);
      if (
        cachedTranscript !== undefined &&
        cachedTranscript !== null &&
        cachedTranscript.length > 0
      ) {
        logger.info(
          {
            messageId: discordMessageId,
            attachmentUrl: attachmentUrl.substring(0, 50),
            transcriptLength: cachedTranscript.length,
            source: 'redis-cache',
          },
          '[TranscriptRetriever] Retrieved voice transcript from Redis cache'
        );
        return cachedTranscript;
      }

      logger.debug(
        {
          messageId: discordMessageId,
          attachmentUrl: attachmentUrl.substring(0, 50),
        },
        'No transcript in Redis cache (DB tier lives worker-side, not in bot-client)'
      );
      return null;
    } catch (error) {
      logger.warn(
        {
          err: error,
          messageId: discordMessageId,
          attachmentUrl: attachmentUrl.substring(0, 50),
        },
        'Error retrieving voice transcript from cache'
      );
      return null;
    }
  }
}
