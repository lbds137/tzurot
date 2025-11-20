/**
 * Transcript Retriever
 *
 * Retrieves voice message transcripts from Redis cache and database
 */

import { createLogger, ConversationHistoryService } from '@tzurot/common-types';
import { voiceTranscriptCache } from '../../redis.js';

const logger = createLogger('TranscriptRetriever');

/**
 * Service for retrieving voice message transcripts
 */
export class TranscriptRetriever {
  constructor(private readonly conversationHistoryService: ConversationHistoryService) {}

  /**
   * Retrieve voice transcript from cache or database
   * @param discordMessageId - Discord message ID
   * @param attachmentUrl - URL of the voice attachment
   * @returns Transcript text or null if not found
   */
  async retrieveTranscript(
    discordMessageId: string,
    attachmentUrl: string
  ): Promise<string | null> {
    try {
      // Tier 1: Check Redis cache (fast path for recent messages)
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

      // Tier 2: Check database (permanent storage)
      // Voice transcripts are stored as the message content in conversation history
      const dbMessage =
        await this.conversationHistoryService.getMessageByDiscordId(discordMessageId);

      if (
        dbMessage?.content !== undefined &&
        dbMessage.content !== null &&
        dbMessage.content.length > 0
      ) {
        // The content field contains the transcript (voice messages use transcript as content)
        logger.info(
          {
            messageId: discordMessageId,
            attachmentUrl: attachmentUrl.substring(0, 50),
            transcriptLength: dbMessage.content.length,
            source: 'database',
          },
          '[TranscriptRetriever] Retrieved voice transcript from database'
        );
        return dbMessage.content;
      }

      logger.debug(
        {
          messageId: discordMessageId,
          attachmentUrl: attachmentUrl.substring(0, 50),
        },
        '[TranscriptRetriever] No transcript found in cache or database'
      );
      return null;
    } catch (error) {
      logger.warn(
        {
          err: error,
          messageId: discordMessageId,
          attachmentUrl: attachmentUrl.substring(0, 50),
        },
        '[TranscriptRetriever] Error retrieving voice transcript'
      );
      return null;
    }
  }
}
