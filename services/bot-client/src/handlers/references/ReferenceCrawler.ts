/**
 * Reference Crawler
 *
 * Performs BFS traversal to collect referenced messages
 * Separates graph traversal from formatting/presentation
 */

import type { Message } from 'discord.js';
import { createLogger, INTERVALS } from '@tzurot/common-types';
import type { IReferenceStrategy } from './strategies/IReferenceStrategy.js';
import type { ReferenceMetadata, ReferenceResult } from './types.js';
import { ReferenceType } from './types.js';
import { LinkExtractor } from './LinkExtractor.js';

const logger = createLogger('ReferenceCrawler');

/**
 * Options for reference crawler
 */
export interface ReferenceCrawlerOptions {
  /** Maximum references to collect */
  maxReferences: number;
  /** Extraction strategies to use */
  strategies: IReferenceStrategy[];
  /** Link extractor for fetching messages */
  linkExtractor: LinkExtractor;
  /** Discord message IDs from conversation history (for deduplication) */
  conversationHistoryMessageIds?: Set<string>;
  /** Conversation history timestamps (for time-based fallback matching) */
  conversationHistoryTimestamps?: Date[];
}

/**
 * Result of crawling references
 */
export interface CrawlResult {
  /** Map of message ID to message and metadata */
  messages: Map<string, { message: Message; metadata: ReferenceMetadata }>;
  /** Total depth reached */
  maxDepth: number;
}

/**
 * Crawls message references using BFS
 */
export class ReferenceCrawler {
  private readonly maxReferences: number;
  private readonly strategies: IReferenceStrategy[];
  private readonly linkExtractor: LinkExtractor;
  private readonly conversationHistoryMessageIds: Set<string>;
  private readonly conversationHistoryTimestamps: Date[];

  constructor(options: ReferenceCrawlerOptions) {
    this.maxReferences = options.maxReferences;
    this.strategies = options.strategies;
    this.linkExtractor = options.linkExtractor;
    this.conversationHistoryMessageIds = options.conversationHistoryMessageIds ?? new Set();
    this.conversationHistoryTimestamps = options.conversationHistoryTimestamps ?? [];
  }

  /**
   * Crawl references starting from root message using BFS
   * @param rootMessage - Starting message
   * @returns Crawl result with fetched messages and metadata
   */
  async crawl(rootMessage: Message): Promise<CrawlResult> {
    const extractedMessageIds = new Set<string>();
    const messages = new Map<string, { message: Message; metadata: ReferenceMetadata }>();

    // BFS queue: [message, depth]
    interface QueueItem {
      message: Message;
      depth: number;
      discordUrl?: string;
    }
    const queue: QueueItem[] = [{ message: rootMessage, depth: 0 }];

    let maxDepth = 0;

    // BFS traversal
    while (queue.length > 0 && messages.size < this.maxReferences) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const current = queue.shift()!;
      const { message: currentMessage, depth } = current;

      maxDepth = Math.max(maxDepth, depth);

      logger.debug(
        {
          messageId: currentMessage.id,
          depth,
          queueLength: queue.length,
          extractedCount: messages.size,
        },
        '[ReferenceCrawler] Processing message at depth level'
      );

      // Extract references using all strategies
      const referenceResults = await this.extractReferencesFromMessage(currentMessage);

      // Fetch and queue referenced messages
      for (const refResult of referenceResults) {
        // Skip if already extracted
        if (extractedMessageIds.has(refResult.messageId)) {
          continue;
        }

        // Fetch the referenced message
        let referencedMessage: Message | null = null;

        // For reply references, use the direct fetchReference() method if available
        if (refResult.type === ReferenceType.REPLY && currentMessage.reference) {
          try {
            referencedMessage = await currentMessage.fetchReference();
          } catch (error) {
            logger.debug(
              {
                messageId: currentMessage.id,
                referencedMessageId: refResult.messageId,
                error: (error as Error).message,
              },
              '[ReferenceCrawler] Failed to fetch reply reference'
            );
          }
        }

        // For link references or if fetchReference failed, use LinkExtractor
        referencedMessage ??= await this.linkExtractor.fetchMessageFromLink(
          {
            guildId: refResult.guildId,
            channelId: refResult.channelId,
            messageId: refResult.messageId,
            fullUrl: refResult.discordUrl ?? '',
          },
          currentMessage
        );

        if (!referencedMessage) {
          continue;
        }

        // Check deduplication - skip if already in conversation history
        // Now that chat_log is chronologically ordered (oldest first, newest last),
        // LLMs properly attend to recent messages. No need to duplicate content.
        if (!this.shouldIncludeReference(referencedMessage)) {
          logger.debug(
            {
              messageId: referencedMessage.id,
              reason: 'found in conversation history',
              isReply: refResult.type === ReferenceType.REPLY,
            },
            '[ReferenceCrawler] Skipping reference - already in conversation'
          );
          continue;
        }

        // Check if we've hit the limit before adding
        if (messages.size >= this.maxReferences) {
          break; // Stop processing more references
        }

        // Mark as extracted
        extractedMessageIds.add(referencedMessage.id);

        // Store message with metadata
        // (Referenced messages are always added, never the root message itself)
        messages.set(referencedMessage.id, {
          message: referencedMessage,
          metadata: {
            messageId: referencedMessage.id,
            depth: depth + 1,
            timestamp: referencedMessage.createdAt,
            discordUrl: refResult.discordUrl,
          },
        });

        // Queue for next depth level (still have room)
        if (messages.size < this.maxReferences) {
          queue.push({
            message: referencedMessage,
            depth: depth + 1,
            discordUrl: refResult.discordUrl,
          });
        }
      }
    }

    logger.info(
      {
        totalReferences: messages.size,
        maxDepth,
      },
      '[ReferenceCrawler] BFS crawl complete'
    );

    return { messages, maxDepth };
  }

  /**
   * Extract all references from a message using configured strategies
   * @param message - Message to extract from
   * @returns Combined results from all strategies
   */
  private async extractReferencesFromMessage(message: Message): Promise<ReferenceResult[]> {
    const allResults = await Promise.all(
      this.strategies.map(strategy => strategy.extract(message))
    );

    return allResults.flat();
  }

  /**
   * Check if a referenced message should be included or excluded as duplicate
   * @param message - Discord message to check
   * @returns True if message should be included, false if it's a duplicate
   */
  private shouldIncludeReference(message: Message): boolean {
    // Exact match: Check if Discord message ID is in conversation history
    if (this.conversationHistoryMessageIds.has(message.id)) {
      return false;
    }

    // Time-based fallback: If message is from bot/webhook and very recent,
    // check if timestamp matches any message in conversation history
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
      if (ageMs < INTERVALS.MESSAGE_AGE_DEDUP_WINDOW) {
        for (const historyTimestamp of this.conversationHistoryTimestamps) {
          const historyTime = historyTimestamp.getTime();
          const timeDiff = Math.abs(messageTime - historyTime);

          // If timestamps match within tolerance, likely the same message
          if (timeDiff < INTERVALS.MESSAGE_TIMESTAMP_TOLERANCE) {
            return false;
          }
        }
      }
    }

    return true;
  }
}
