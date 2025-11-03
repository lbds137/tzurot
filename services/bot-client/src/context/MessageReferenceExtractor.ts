/**
 * Message Reference Extractor
 *
 * Extracts and formats referenced messages from replies and message links
 */

import { Message, TextChannel, ThreadChannel, Channel } from 'discord.js';
import { MessageLinkParser, ParsedMessageLink } from '../utils/MessageLinkParser.js';
import { EmbedParser } from '../utils/EmbedParser.js';
import { createLogger, ReferencedMessage } from '@tzurot/common-types';

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
  /** Maximum number of references to extract (default: 10) */
  maxReferences?: number;
  /** Delay in ms before fetching to allow Discord to process embeds (default: 2500ms) */
  embedProcessingDelayMs?: number;
  /** Discord message IDs from conversation history (for deduplication) */
  conversationHistoryMessageIds?: string[];
  /** Timestamp range of conversation history (for fuzzy deduplication of old messages) */
  conversationHistoryTimeRange?: {
    oldest: Date;
    newest: Date;
  };
}

/**
 * Message Reference Extractor
 * Extracts referenced messages from replies and message links
 */
export class MessageReferenceExtractor {
  private readonly maxReferences: number;
  private readonly embedProcessingDelayMs: number;
  private conversationHistoryMessageIds: Set<string>;
  private conversationHistoryTimeRange?: {
    oldest: Date;
    newest: Date;
  };

  constructor(options: ReferenceExtractionOptions = {}) {
    this.maxReferences = options.maxReferences ?? 10;
    this.embedProcessingDelayMs = options.embedProcessingDelayMs ?? 2500;
    this.conversationHistoryMessageIds = new Set(options.conversationHistoryMessageIds || []);
    this.conversationHistoryTimeRange = options.conversationHistoryTimeRange;
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
    if (updatedMessage.reference?.messageId) {
      try {
        const referencedMessage = await updatedMessage.fetchReference();

        // Skip if message is already in conversation history
        if (!this.shouldIncludeReference(referencedMessage)) {
          logger.debug(`[MessageReferenceExtractor] Skipping reply reference ${referencedMessage.id} - already in conversation history`);
        } else {
          // Format and add the reply reference
          const replyReference = this.formatReferencedMessage(referencedMessage, 1);
          references.push(replyReference);
        }

        // Always track the message ID to prevent duplicates in links
        extractedMessageIds.add(referencedMessage.id);
      } catch (error) {
        // Silently skip inaccessible messages
        logger.debug(`[MessageReferenceExtractor] Could not fetch reply reference: ${(error as Error).message}`);
      }
    }

    // Extract message link references (excluding any already extracted from reply)
    if (updatedMessage.content) {
      // Pass the current reference count so link references can be numbered correctly
      const startNumber = references.length + 1;
      const [linkReferences, linkToRefMap] = await this.extractLinkReferences(
        updatedMessage,
        extractedMessageIds,
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
      logger.info(`[MessageReferenceExtractor] Limiting ${references.length} references to ${this.maxReferences}`);
      const limitedReferences = references.slice(0, this.maxReferences);

      // Update linkMap to only include references that made the cut
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
   * Extract references from message links in content
   * @param message - Discord message containing links
   * @param extractedMessageIds - Set of already-extracted message IDs to prevent duplicates
   * @param startNumber - Reference number to start from (accounts for any reply references)
   * @returns Tuple of [referenced messages, link URL to reference number map]
   */
  private async extractLinkReferences(
    message: Message,
    extractedMessageIds: Set<string>,
    startNumber: number
  ): Promise<[ReferencedMessage[], Map<string, number>]> {
    const links = MessageLinkParser.parseMessageLinks(message.content);
    const references: ReferencedMessage[] = [];
    const linkMap = new Map<string, number>(); // Map Discord URL to reference number

    let currentNumber = startNumber;

    for (const link of links) {
      const referencedMessage = await this.fetchMessageFromLink(link, message);
      if (referencedMessage) {
        // Skip if this exact message was already extracted (e.g., from reply)
        if (extractedMessageIds.has(referencedMessage.id)) {
          logger.debug(`[MessageReferenceExtractor] Skipping duplicate link reference ${referencedMessage.id} - already extracted from reply`);
          continue;
        }

        // Skip if message is already in conversation history
        if (!this.shouldIncludeReference(referencedMessage)) {
          logger.debug(`[MessageReferenceExtractor] Skipping link reference ${referencedMessage.id} - already in conversation history`);
          continue;
        }

        references.push(this.formatReferencedMessage(referencedMessage, currentNumber));
        linkMap.set(link.fullUrl, currentNumber); // Map the Discord URL to this reference number
        extractedMessageIds.add(referencedMessage.id); // Track this ID to prevent duplicates within links
        currentNumber++;
      }
    }

    return [references, linkMap];
  }

  /**
   * Fetch a message from a parsed Discord link
   * @param link - Parsed message link
   * @param sourceMessage - Original message (for guild access)
   * @returns Discord message or null if not accessible
   */
  private async fetchMessageFromLink(
    link: ParsedMessageLink,
    sourceMessage: Message
  ): Promise<Message | null> {
    try {
      const guild = sourceMessage.client.guilds.cache.get(link.guildId);
      if (!guild) {
        logger.debug(`[MessageReferenceExtractor] Guild ${link.guildId} not accessible`);
        return null;
      }

      const channel = guild.channels.cache.get(link.channelId);
      if (!channel || !this.isTextBasedChannel(channel)) {
        logger.debug(`[MessageReferenceExtractor] Channel ${link.channelId} not accessible or not text-based`);
        return null;
      }

      const fetchedMessage = await (channel as TextChannel | ThreadChannel).messages.fetch(link.messageId);
      return fetchedMessage;
    } catch (error) {
      // Silently skip inaccessible messages
      logger.debug(`[MessageReferenceExtractor] Could not fetch message ${link.messageId}: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Format a Discord message as a referenced message
   * @param message - Discord message
   * @param referenceNumber - Reference number
   * @returns Formatted referenced message
   */
  private formatReferencedMessage(message: Message, referenceNumber: number): ReferencedMessage {
    const guildName = message.guild?.name ?? 'Direct Messages';
    const channelName = this.getChannelName(message.channel);

    return {
      referenceNumber,
      authorUsername: message.author.username,
      authorDisplayName: message.author.displayName ?? message.author.username,
      content: message.content,
      embeds: EmbedParser.parseMessageEmbeds(message),
      timestamp: message.createdAt.toISOString(),
      guildName,
      channelName
    };
  }

  /**
   * Get channel name from a Discord channel
   * @param channel - Discord channel
   * @returns Channel name
   */
  private getChannelName(channel: Channel): string {
    if (channel.isDMBased()) {
      return 'Direct Message';
    }

    if ('name' in channel) {
      return `#${channel.name}`;
    }

    return 'Unknown Channel';
  }

  /**
   * Check if channel is text-based and supports message fetching
   * @param channel - Discord channel
   * @returns True if channel is text-based
   */
  private isTextBasedChannel(channel: Channel | null): boolean {
    return channel !== null && channel.isTextBased() && 'messages' in channel;
  }

  /**
   * Re-fetch a message to get updated embeds
   * @param message - Original message
   * @returns Re-fetched message
   */
  private async refetchMessage(message: Message): Promise<Message> {
    try {
      // Check if channel is text-based and has messages property
      if ('messages' in message.channel && message.channel.messages) {
        return await message.channel.messages.fetch(message.id);
      }
      return message;
    } catch (error) {
      logger.debug(`[MessageReferenceExtractor] Could not refetch message: ${(error as Error).message}`);
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
      return false; // Exclude - already in conversation history
    }

    // Fuzzy match: Check if message timestamp falls within conversation history range
    // This handles old messages that don't have Discord IDs stored
    if (this.conversationHistoryTimeRange) {
      const messageTimestamp = message.createdAt.getTime();
      const oldestTimestamp = this.conversationHistoryTimeRange.oldest.getTime();
      const newestTimestamp = this.conversationHistoryTimeRange.newest.getTime();

      if (messageTimestamp >= oldestTimestamp && messageTimestamp <= newestTimestamp) {
        return false; // Exclude - likely in conversation history based on timestamp
      }
    }

    return true; // Include - not found in conversation history
  }

  /**
   * Delay helper for waiting for embed processing
   * @param ms - Milliseconds to delay
   */
  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

}
