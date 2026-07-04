/**
 * Message Reference Extractor (Refactored Facade)
 *
 * Thin coordinator that delegates to:
 * - ReferenceCrawler: BFS traversal and message fetching
 * - ReferenceFormatter: Sorting, numbering, and presentation
 *
 * This facade maintains the original public API for backwards compatibility
 */

import { INTERVALS } from '@tzurot/common-types/constants/timing';
import { type ReferencedMessage } from '@tzurot/common-types/types/schemas/message';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type Message } from 'discord.js';
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
  /**
   * Raw pre-enrichment reference snapshots for the assembly envelope —
   * present only when CONTEXT_RAW_ENVELOPE=true. Full content always (no
   * transcripts, no dedup stubs), same numbering as `references`.
   */
  rawReferences?: ReferencedMessage[];
}

/**
 * Options for message reference extraction
 */
interface ReferenceExtractionOptions {
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
    const transcriptRetriever = new TranscriptRetriever();
    const snapshotFormatter = new SnapshotFormatter();
    const messageFormatter = new MessageFormatter(transcriptRetriever);
    const linkExtractor = new LinkExtractor();

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
   * @param effectiveContent - The authoritative message text to apply link
   *   replacement to. For forwarded messages the real text lives in a snapshot,
   *   so `message.content` (top-level) is empty; the caller passes the
   *   snapshot-extracted content here. Falls back to `message.content` when
   *   omitted (the references-only public path).
   * @returns References and updated content with links replaced
   */
  async extractReferencesWithReplacement(
    message: Message,
    effectiveContent?: string
  ): Promise<ReferenceExtractionResult> {
    // Wait for Discord to process embeds
    await this.delay(this.embedProcessingDelayMs);

    // Re-fetch the message to get updated embeds
    const updatedMessage = await this.refetchMessage(message);

    logger.debug(
      {
        messageId: updatedMessage.id,
        maxReferences: this.maxReferences,
      },
      'Starting reference extraction'
    );

    // Step 1: Crawl references using BFS
    const crawlResult = await this.crawler.crawl(updatedMessage);

    logger.info(
      {
        totalReferences: crawlResult.messages.size,
        maxDepth: crawlResult.maxDepth,
      },
      'Crawl complete'
    );

    // Step 2: Format references (sort, number, replace links).
    // Apply link replacement to the effective content (snapshot text for
    // forwards), not the empty top-level content — otherwise a forward's real
    // text is lost when the caller adopts updatedContent.
    const formattedResult = await this.formatter.format(
      effectiveContent ?? updatedMessage.content,
      crawlResult.messages,
      this.maxReferences,
      // Raw references always captured — the thin envelope is the only payload
      // shape, and the worker re-derives from these.
      { collectRaw: true }
    );

    return {
      references: formattedResult.references,
      updatedContent: formattedResult.updatedContent,
      ...(formattedResult.rawReferences !== undefined && {
        rawReferences: formattedResult.rawReferences,
      }),
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
      logger.debug({ err: error }, 'Could not refetch message');
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
