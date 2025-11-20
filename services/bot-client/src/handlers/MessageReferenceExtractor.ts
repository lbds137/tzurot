/**
 * Message Reference Extractor
 *
 * Extracts and formats referenced messages from replies and message links
 */

import type { PrismaClient } from '@prisma/client';
import { Message, MessageReferenceType } from 'discord.js';
import { MessageLinkParser } from '../utils/MessageLinkParser.js';
import { createLogger, INTERVALS, ReferencedMessage } from '@tzurot/common-types';
import { ConversationHistoryService } from '@tzurot/common-types';
import { TranscriptRetriever } from './references/TranscriptRetriever.js';
import { SnapshotFormatter } from './references/SnapshotFormatter.js';
import { MessageFormatter } from './references/MessageFormatter.js';
import { LinkExtractor } from './references/LinkExtractor.js';

const logger = createLogger('MessageReferenceExtractor');

/**
 * Result of reference extraction with link replacement
 */
export interface ReferenceExtractionResult {
  /** Extracted referenced messages */
  references: ReferencedMessage[];
  /** Updated message content with Discord links replaced by [Reference N] */
  updatedContent: string;
}

/**
 * Options for message reference extraction
 */
export interface ReferenceExtractionOptions {
  /** Prisma client for database operations */
  prisma: PrismaClient;
  /** Maximum number of references to extract (default: 10) */
  maxReferences?: number;
  /** Delay in ms before fetching to allow Discord to process embeds (default: 2500ms) */
  embedProcessingDelayMs?: number;
  /** Discord message IDs from conversation history (for deduplication) */
  conversationHistoryMessageIds?: string[];
  /** Conversation history timestamps (for time-based fallback matching) */
  conversationHistoryTimestamps?: Date[];
}

/**
 * Message Reference Extractor
 * Extracts referenced messages from replies and message links
 */
export class MessageReferenceExtractor {
  private readonly maxReferences: number;
  private readonly embedProcessingDelayMs: number;
  private conversationHistoryMessageIds: Set<string>;
  private conversationHistoryTimestamps: Date[];
  private readonly conversationHistoryService: ConversationHistoryService;
  private readonly transcriptRetriever: TranscriptRetriever;
  private readonly snapshotFormatter: SnapshotFormatter;
  private readonly messageFormatter: MessageFormatter;
  private readonly linkExtractor: LinkExtractor;

  constructor(options: ReferenceExtractionOptions) {
    this.maxReferences = options.maxReferences ?? 10;

    // ARCHITECTURAL DECISION: 2.5s embed processing delay
    //
    // Why this delay exists:
    // 1. Discord embeds populate asynchronously (1-2s after message send)
    // 2. Future PluralKit support requires detecting proxy messages via embed metadata
    //    - PluralKit webhooks include original author info in embeds
    //    - Embeds take 1-3s to populate after webhook send
    //    - We need to re-fetch messages after this delay to get embed data
    // 3. Without this delay, we'd see webhook messages without author info
    //
    // Trade-off: Adds 2.5s latency to ALL personality responses
    // Benefit: Enables proper PluralKit integration (distinguishing proxy vs bot messages)
    this.embedProcessingDelayMs =
      options.embedProcessingDelayMs ?? INTERVALS.EMBED_PROCESSING_DELAY;
    this.conversationHistoryMessageIds = new Set(options.conversationHistoryMessageIds ?? []);
    this.conversationHistoryTimestamps = options.conversationHistoryTimestamps ?? [];
    this.conversationHistoryService = new ConversationHistoryService(options.prisma);

    // Initialize extracted services
    this.transcriptRetriever = new TranscriptRetriever(this.conversationHistoryService);
    this.snapshotFormatter = new SnapshotFormatter();
    this.messageFormatter = new MessageFormatter(this.transcriptRetriever);
    this.linkExtractor = new LinkExtractor(this.messageFormatter, this.snapshotFormatter);
  }

  /**
   * Extract all referenced messages from a Discord message
   * @param message - Discord message to extract references from
   * @returns Array of referenced messages
   */
  async extractReferences(message: Message): Promise<ReferencedMessage[]> {
    const result = await this.extractReferencesWithReplacement(message);
    return result.references;
  }

  /**
   * Extract all referenced messages and replace Discord links with [Reference N]
   * @param message - Discord message to extract references from
   * @returns References and updated content with links replaced
   */
  async extractReferencesWithReplacement(message: Message): Promise<ReferenceExtractionResult> {
    const references: ReferencedMessage[] = [];
    const extractedMessageIds = new Set<string>(); // Track message IDs to prevent duplicates
    const linkMap = new Map<string, number>(); // Map Discord URL to reference number for replacement

    // Wait for Discord to process embeds
    await this.delay(this.embedProcessingDelayMs);

    // Re-fetch the message to get updated embeds
    const updatedMessage = await this.refetchMessage(message);

    // Extract reply-to reference (if present)
    if (
      updatedMessage.reference?.messageId !== undefined &&
      updatedMessage.reference.messageId !== null &&
      updatedMessage.reference.messageId.length > 0
    ) {
      logger.info(
        {
          hasReference: true,
          messageId: updatedMessage.reference.messageId,
        },
        '[MessageReferenceExtractor] Message has reply reference, attempting to fetch'
      );

      try {
        const referencedMessage = await updatedMessage.fetchReference();

        // Check if this is a reply to a forwarded message
        if (referencedMessage.reference?.type === MessageReferenceType.Forward) {
          logger.info(
            {
              messageId: referencedMessage.id,
              snapshotCount: referencedMessage.messageSnapshots?.size || 0,
            },
            '[MessageReferenceExtractor] Detected forwarded message, extracting snapshots'
          );

          // Extract snapshots from the forwarded message
          if (
            referencedMessage.messageSnapshots !== undefined &&
            referencedMessage.messageSnapshots !== null &&
            referencedMessage.messageSnapshots.size > 0
          ) {
            let snapshotNumber = 1;
            for (const [, snapshot] of referencedMessage.messageSnapshots) {
              const snapshotRef = this.snapshotFormatter.formatSnapshot(
                snapshot,
                snapshotNumber,
                referencedMessage
              );
              references.push(snapshotRef);
              logger.info(
                {
                  referenceNumber: snapshotNumber,
                  contentPreview: snapshot.content?.substring(0, 50) || '(no content)',
                },
                '[MessageReferenceExtractor] Added forwarded message snapshot'
              );
              snapshotNumber++;
            }
          } else {
            logger.warn(
              {
                messageId: referencedMessage.id,
              },
              '[MessageReferenceExtractor] Forward detected but no snapshots found'
            );
          }

          // Track the forward message ID to prevent duplicates
          extractedMessageIds.add(referencedMessage.id);
        } else {
          // Regular reply (not forwarded)
          // Skip if message is already in conversation history
          if (!this.shouldIncludeReference(referencedMessage)) {
            logger.info(
              {
                messageId: referencedMessage.id,
                reason: 'already in conversation history',
              },
              `[MessageReferenceExtractor] Skipping reply reference - already in conversation history`
            );
          } else {
            // Format and add the reply reference
            const replyReference = await this.messageFormatter.formatMessage(referencedMessage, 1);
            references.push(replyReference);
            logger.info(
              {
                messageId: referencedMessage.id,
                referenceNumber: 1,
                author: referencedMessage.author.username,
                contentPreview: referencedMessage.content.substring(0, 50),
              },
              '[MessageReferenceExtractor] Added reply reference'
            );
          }

          // Always track the message ID to prevent duplicates in links
          extractedMessageIds.add(referencedMessage.id);
        }
      } catch (error) {
        // Differentiate between expected and unexpected errors
        const discordError = error as Error & { code?: number };
        const errorCode = discordError.code;

        if (errorCode === 10008) {
          // Unknown Message - deleted or never existed (expected)
          logger.debug(
            `[MessageReferenceExtractor] Reply reference not found (deleted or inaccessible)`
          );
        } else if (errorCode === 50001 || errorCode === 50013) {
          // Missing Access / Missing Permissions (expected)
          logger.debug(`[MessageReferenceExtractor] No permission to access reply reference`);
        } else {
          // Unexpected error - log at WARN level for investigation
          logger.warn(
            {
              err: error,
              messageId: updatedMessage.reference.messageId,
            },
            '[MessageReferenceExtractor] Unexpected error fetching reply reference'
          );
        }
      }
    }

    // Extract message link references (excluding any already extracted from reply)
    if (updatedMessage.content) {
      // Pass the current reference count so link references can be numbered correctly
      const startNumber = references.length + 1;
      const [linkReferences, linkToRefMap] = await this.linkExtractor.extractLinkReferences(
        updatedMessage,
        extractedMessageIds,
        this.conversationHistoryMessageIds,
        this.conversationHistoryTimestamps,
        startNumber
      );
      references.push(...linkReferences);

      // Merge the link map for replacement
      for (const [url, refNum] of linkToRefMap) {
        linkMap.set(url, refNum);
      }
    }

    // Limit to max references
    if (references.length > this.maxReferences) {
      logger.info(
        `[MessageReferenceExtractor] Limiting ${references.length} references to ${this.maxReferences}`
      );
      const limitedReferences = references.slice(0, this.maxReferences);

      // Update linkMap to only include references that made the cut
      // Edge case behavior: If a user posts 15 message links, only the first 10 are replaced
      // with [Reference N]. Links 11-15 remain as raw Discord URLs in the message content.
      // This prevents context bloat while keeping all links visible to the user.
      const limitedRefNumbers = new Set(limitedReferences.map(r => r.referenceNumber));
      for (const [url, refNum] of linkMap) {
        if (!limitedRefNumbers.has(refNum)) {
          linkMap.delete(url);
        }
      }

      // Replace links in content
      const updatedContent = MessageLinkParser.replaceLinksWithReferences(
        updatedMessage.content,
        linkMap
      );

      return { references: limitedReferences, updatedContent };
    }

    // Replace links in content
    const updatedContent = MessageLinkParser.replaceLinksWithReferences(
      updatedMessage.content,
      linkMap
    );

    return { references, updatedContent };
  }

  /**
   * Re-fetch a message to get updated embeds
   * @param message - Original message
   * @returns Re-fetched message
   */
  private async refetchMessage(message: Message): Promise<Message> {
    try {
      // Check if channel is text-based and has messages property
      if (
        'messages' in message.channel &&
        message.channel.messages !== undefined &&
        message.channel.messages !== null
      ) {
        return await message.channel.messages.fetch(message.id);
      }
      return message;
    } catch (error) {
      logger.debug(
        `[MessageReferenceExtractor] Could not refetch message: ${(error as Error).message}`
      );
      return message;
    }
  }

  /**
   * Check if a referenced message should be included or excluded as duplicate
   * @param message - Discord message to check
   * @returns True if message should be included, false if it's a duplicate
   */
  private shouldIncludeReference(message: Message): boolean {
    // Exact match: Check if Discord message ID is in conversation history
    if (this.conversationHistoryMessageIds.has(message.id)) {
      logger.info(
        {
          messageId: message.id,
          author: message.author.username,
          reason: 'exact Discord ID match',
        },
        '[MessageReferenceExtractor] Excluding reference - found in conversation history'
      );
      return false; // Exclude - already in conversation history
    }

    // Time-based fallback: If message is from bot/webhook and very recent,
    // check if timestamp matches any message in conversation history
    // This handles race condition where Discord message ID hasn't been stored in DB yet
    // Common with voice messages in threads where transcription adds significant delay
    if (
      (message.webhookId !== undefined &&
        message.webhookId !== null &&
        message.webhookId.length > 0) ||
      message.author.bot === true
    ) {
      const messageTime = message.createdAt.getTime();
      const now = Date.now();
      const ageMs = now - messageTime;

      // Only check recent messages (within last 60 seconds)
      // Voice messages with transcription can have longer processing windows
      if (ageMs < INTERVALS.MESSAGE_AGE_DEDUP_WINDOW) {
        for (const historyTimestamp of this.conversationHistoryTimestamps) {
          const historyTime = historyTimestamp.getTime();
          const timeDiff = Math.abs(messageTime - historyTime);

          // If timestamps match within 15 seconds, likely the same message
          // Generous tolerance accounts for:
          // - Voice transcription delays (several seconds)
          // - DB round-trip and transaction commit times
          // - Job queue processing delays
          if (timeDiff < INTERVALS.MESSAGE_TIMESTAMP_TOLERANCE) {
            logger.info(
              {
                messageId: message.id,
                author: message.author.username,
                reason: 'timestamp match with conversation history',
                messageAge: `${Math.round(ageMs / 1000)}s ago`,
                timeDiff: `${timeDiff}ms`,
              },
              '[MessageReferenceExtractor] Excluding reference - timestamp matches conversation history (time-based fallback)'
            );
            return false; // Exclude - timestamp matches recent conversation history
          }
        }
      }
    }

    logger.info(
      {
        messageId: message.id,
        author: message.author.username,
        isWebhook:
          message.webhookId !== undefined &&
          message.webhookId !== null &&
          message.webhookId.length > 0,
        isBot: message.author.bot,
        messageAge:
          message.createdAt !== undefined && message.createdAt !== null
            ? `${Math.round((Date.now() - message.createdAt.getTime()) / 1000)}s`
            : 'unknown',
        historyIdsCount: this.conversationHistoryMessageIds.size,
        historyTimestampsCount: this.conversationHistoryTimestamps.length,
      },
      '[MessageReferenceExtractor] Including reference - not found in conversation history (deduplication failed)'
    );

    return true; // Include - not found in conversation history
  }

  /**
   * Delay helper for waiting for embed processing
   * @param ms - Milliseconds to delay
   */
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
