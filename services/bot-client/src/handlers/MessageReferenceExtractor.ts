/**
 * Message Reference Extractor (Refactored Facade)
 *
 * Thin coordinator that delegates to:
 * - ReferenceCrawler: BFS traversal and message fetching
 * - ReferenceFormatter: Sorting, numbering, and presentation
 *
 * This facade maintains the original public API for backwards compatibility
 */

import type { PrismaClient } from '@tzurot/common-types';
import { Message } from 'discord.js';
import { createLogger, INTERVALS, type ReferencedMessage } from '@tzurot/common-types';
import { ConversationHistoryService } from '@tzurot/common-types';
import { TranscriptRetriever } from './references/TranscriptRetriever.js';
import { SnapshotFormatter } from './references/SnapshotFormatter.js';
import { MessageFormatter } from './references/MessageFormatter.js';
import { LinkExtractor } from './references/LinkExtractor.js';
import { ReferenceCrawler } from './references/ReferenceCrawler.js';
import { ReferenceFormatter } from './references/ReferenceFormatter.js';
import { ReplyReferenceStrategy } from './references/strategies/ReplyReferenceStrategy.js';
import { LinkReferenceStrategy } from './references/strategies/LinkReferenceStrategy.js';

const logger = createLogger('MessageReferenceExtractor');

/**
 * Result of reference extraction with link replacement
 */
interface ReferenceExtractionResult {
  /** Extracted referenced messages */
  references: ReferencedMessage[];
  /** Updated message content with Discord links replaced by [Reference N] */
  updatedContent: string;
}

/**
 * Options for message reference extraction
 */
interface ReferenceExtractionOptions {
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
 * Message Reference Extractor (Facade)
 * Coordinates reference crawling and formatting
 */
export class MessageReferenceExtractor {
  private readonly maxReferences: number;
  private readonly embedProcessingDelayMs: number;
  private readonly crawler: ReferenceCrawler;
  private readonly formatter: ReferenceFormatter;

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

    // Initialize dependencies
    const conversationHistoryService = new ConversationHistoryService(options.prisma);
    const transcriptRetriever = new TranscriptRetriever(conversationHistoryService);
    const snapshotFormatter = new SnapshotFormatter();
    const messageFormatter = new MessageFormatter(transcriptRetriever);
    const linkExtractor = new LinkExtractor(messageFormatter, snapshotFormatter);

    // Initialize extraction strategies
    const strategies = [new ReplyReferenceStrategy(), new LinkReferenceStrategy()];

    // Initialize crawler
    this.crawler = new ReferenceCrawler({
      maxReferences: this.maxReferences,
      strategies,
      linkExtractor,
      conversationHistoryMessageIds: new Set(options.conversationHistoryMessageIds ?? []),
      conversationHistoryTimestamps: options.conversationHistoryTimestamps ?? [],
    });

    // Initialize formatter
    this.formatter = new ReferenceFormatter(messageFormatter, snapshotFormatter);
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
   * Uses breadth-first search to handle nested references.
   *
   * Algorithm (delegated to ReferenceCrawler and ReferenceFormatter):
   * 1. BFS crawl to collect referenced messages (depth-first traversal)
   * 2. Format and sort references (depth, then chronologically)
   * 3. Assign reference numbers sequentially
   * 4. Replace Discord links with [Reference N] placeholders
   *
   * @param message - Discord message to extract references from
   * @returns References and updated content with links replaced
   */
  async extractReferencesWithReplacement(message: Message): Promise<ReferenceExtractionResult> {
    // Wait for Discord to process embeds
    await this.delay(this.embedProcessingDelayMs);

    // Re-fetch the message to get updated embeds
    const updatedMessage = await this.refetchMessage(message);

    logger.debug(
      {
        messageId: updatedMessage.id,
        maxReferences: this.maxReferences,
      },
      '[MessageReferenceExtractor] Starting reference extraction'
    );

    // Step 1: Crawl references using BFS
    const crawlResult = await this.crawler.crawl(updatedMessage);

    logger.info(
      {
        totalReferences: crawlResult.messages.size,
        maxDepth: crawlResult.maxDepth,
      },
      '[MessageReferenceExtractor] Crawl complete'
    );

    // Step 2: Format references (sort, number, replace links)
    const formattedResult = await this.formatter.format(
      updatedMessage.content,
      crawlResult.messages,
      this.maxReferences
    );

    return {
      references: formattedResult.references,
      updatedContent: formattedResult.updatedContent,
    };
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
   * Delay helper for waiting for embed processing
   * @param ms - Milliseconds to delay
   */
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
