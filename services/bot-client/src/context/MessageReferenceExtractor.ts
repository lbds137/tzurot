/**
 * Message Reference Extractor
 *
 * Extracts and formats referenced messages from replies and message links
 */

import { Message, TextChannel, ThreadChannel, Channel } from 'discord.js';
import { MessageLinkParser, ParsedMessageLink } from '../utils/MessageLinkParser.js';
import { EmbedParser } from '../utils/EmbedParser.js';
import { createLogger } from '@tzurot/common-types';

const logger = createLogger('MessageReferenceExtractor');

/**
 * Referenced message data
 */
export interface ReferencedMessage {
  /** Reference number (1, 2, 3, etc.) */
  referenceNumber: number;
  /** Author username */
  authorUsername: string;
  /** Author display name */
  authorDisplayName: string;
  /** Message content */
  content: string;
  /** Formatted embeds (if any) */
  embeds: string;
  /** Timestamp (ISO 8601 string) */
  timestamp: string;
  /** Guild name (or "Direct Messages") */
  guildName: string;
  /** Channel name */
  channelName: string;
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
    const references: ReferencedMessage[] = [];

    // Wait for Discord to process embeds
    await this.delay(this.embedProcessingDelayMs);

    // Re-fetch the message to get updated embeds
    const updatedMessage = await this.refetchMessage(message);

    // Extract reply-to reference (if present)
    if (updatedMessage.reference?.messageId) {
      const replyReference = await this.extractReplyReference(updatedMessage);
      if (replyReference) {
        references.push(replyReference);
      }
    }

    // Extract message link references
    if (updatedMessage.content) {
      const linkReferences = await this.extractLinkReferences(updatedMessage);
      references.push(...linkReferences);
    }

    // Limit to max references
    if (references.length > this.maxReferences) {
      logger.info(`[MessageReferenceExtractor] Limiting ${references.length} references to ${this.maxReferences}`);
      return references.slice(0, this.maxReferences);
    }

    return references;
  }

  /**
   * Extract reference from reply-to message
   * @param message - Discord message with reference
   * @returns Referenced message or null if not accessible
   */
  private async extractReplyReference(message: Message): Promise<ReferencedMessage | null> {
    try {
      const referencedMessage = await message.fetchReference();

      // Skip if message is already in conversation history
      if (!this.shouldIncludeReference(referencedMessage)) {
        logger.debug(`[MessageReferenceExtractor] Skipping reply reference ${referencedMessage.id} - already in conversation history`);
        return null;
      }

      return this.formatReferencedMessage(referencedMessage, 1);
    } catch (error) {
      // Silently skip inaccessible messages
      logger.debug(`[MessageReferenceExtractor] Could not fetch reply reference: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Extract references from message links in content
   * @param message - Discord message containing links
   * @returns Array of referenced messages
   */
  private async extractLinkReferences(message: Message): Promise<ReferencedMessage[]> {
    const links = MessageLinkParser.parseMessageLinks(message.content);
    const references: ReferencedMessage[] = [];

    // Start numbering after reply-to (if present)
    let startNumber = message.reference?.messageId ? 2 : 1;

    for (const link of links) {
      const referencedMessage = await this.fetchMessageFromLink(link, message);
      if (referencedMessage) {
        // Skip if message is already in conversation history
        if (!this.shouldIncludeReference(referencedMessage)) {
          logger.debug(`[MessageReferenceExtractor] Skipping link reference ${referencedMessage.id} - already in conversation history`);
          continue;
        }

        references.push(this.formatReferencedMessage(referencedMessage, startNumber));
        startNumber++;
      }
    }

    return references;
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

  /**
   * Format references for LLM prompt
   * @param references - Array of referenced messages
   * @param originalContent - Original message content
   * @returns Formatted reference section and updated content
   */
  static formatReferencesForPrompt(
    references: ReferencedMessage[],
    originalContent: string
  ): { updatedContent: string; referenceSection: string } {
    if (references.length === 0) {
      return {
        updatedContent: originalContent,
        referenceSection: ''
      };
    }

    // Build link map for replacement
    const linkMap = new Map<string, number>();
    references.forEach(ref => {
      // Find the original link for this reference
      // This is a bit tricky - we need to match back to the original links
      // For now, we'll use the reference number directly
      linkMap.set(`Reference ${ref.referenceNumber}`, ref.referenceNumber);
    });

    // Replace message links in content
    const updatedContent = MessageLinkParser.replaceLinksWithReferences(
      originalContent,
      linkMap
    );

    // Build reference section
    const referenceLines: string[] = [];
    referenceLines.push('## Referenced Messages\n');

    for (const ref of references) {
      referenceLines.push(`[Reference ${ref.referenceNumber}]`);
      referenceLines.push(`From: ${ref.authorDisplayName} (@${ref.authorUsername})`);
      referenceLines.push(`Location: ${ref.guildName} > ${ref.channelName}`);
      referenceLines.push(`Time: ${ref.timestamp}`);

      if (ref.content) {
        referenceLines.push(`\nContent:\n${ref.content}`);
      }

      if (ref.embeds) {
        referenceLines.push(`\n${ref.embeds}`);
      }

      referenceLines.push(''); // Empty line between references
    }

    return {
      updatedContent,
      referenceSection: referenceLines.join('\n')
    };
  }
}
