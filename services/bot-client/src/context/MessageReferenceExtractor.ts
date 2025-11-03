/**
 * Message Reference Extractor
 *
 * Extracts and formats referenced messages from replies and message links
 */

import { Message, TextChannel, ThreadChannel, Channel } from 'discord.js';
import { MessageLinkParser, ParsedMessageLink } from '../utils/MessageLinkParser.js';
import { EmbedParser } from '../utils/EmbedParser.js';
import { extractAttachments } from '../utils/attachmentExtractor.js';
import { extractEmbedImages } from '../utils/embedImageExtractor.js';
import { createLogger, ReferencedMessage } from '@tzurot/common-types';
import { extractDiscordEnvironment, formatEnvironmentForPrompt } from '../utils/discordContext.js';

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
}

/**
 * Message Reference Extractor
 * Extracts referenced messages from replies and message links
 */
export class MessageReferenceExtractor {
  private readonly maxReferences: number;
  private readonly embedProcessingDelayMs: number;
  private conversationHistoryMessageIds: Set<string>;

  constructor(options: ReferenceExtractionOptions = {}) {
    this.maxReferences = options.maxReferences ?? 10;
    // Discord typically processes embeds within 1-2 seconds of message creation
    // 2.5s provides a safe margin without excessive delay
    // This also prepares for future PluralKit proxy detection (which takes 1-3s)
    this.embedProcessingDelayMs = options.embedProcessingDelayMs ?? 2500;
    this.conversationHistoryMessageIds = new Set(options.conversationHistoryMessageIds || []);
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
      logger.info({
        hasReference: true,
        messageId: updatedMessage.reference.messageId
      }, '[MessageReferenceExtractor] Message has reply reference, attempting to fetch');

      try {
        const referencedMessage = await updatedMessage.fetchReference();

        // Skip if message is already in conversation history
        if (!this.shouldIncludeReference(referencedMessage)) {
          logger.info({
            messageId: referencedMessage.id,
            reason: 'already in conversation history'
          }, `[MessageReferenceExtractor] Skipping reply reference - already in conversation history`);
        } else {
          // Format and add the reply reference
          const replyReference = this.formatReferencedMessage(referencedMessage, 1);
          references.push(replyReference);
          logger.info({
            messageId: referencedMessage.id,
            referenceNumber: 1,
            author: referencedMessage.author.username,
            contentPreview: referencedMessage.content.substring(0, 50)
          }, '[MessageReferenceExtractor] Added reply reference');
        }

        // Always track the message ID to prevent duplicates in links
        extractedMessageIds.add(referencedMessage.id);
      } catch (error) {
        // Differentiate between expected and unexpected errors
        const discordError = error as any;
        const errorCode = discordError?.code;

        if (errorCode === 10008) {
          // Unknown Message - deleted or never existed (expected)
          logger.debug(`[MessageReferenceExtractor] Reply reference not found (deleted or inaccessible)`);
        } else if (errorCode === 50001 || errorCode === 50013) {
          // Missing Access / Missing Permissions (expected)
          logger.debug(`[MessageReferenceExtractor] No permission to access reply reference`);
        } else {
          // Unexpected error - log at WARN level for investigation
          logger.warn({
            err: error,
            messageId: updatedMessage.reference.messageId
          }, '[MessageReferenceExtractor] Unexpected error fetching reply reference');
        }
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
      // Try to get guild from cache first
      let guild = sourceMessage.client.guilds.cache.get(link.guildId);

      // If not in cache, try to fetch it (bot might be in the guild but it's not cached)
      if (!guild) {
        try {
          logger.debug({
            guildId: link.guildId,
            messageId: link.messageId
          }, '[MessageReferenceExtractor] Guild not in cache, attempting fetch...');

          guild = await sourceMessage.client.guilds.fetch(link.guildId);

          logger.info({
            guildId: link.guildId,
            guildName: guild.name
          }, '[MessageReferenceExtractor] Successfully fetched guild');
        } catch (fetchError) {
          logger.info({
            guildId: link.guildId,
            messageId: link.messageId,
            err: fetchError
          }, '[MessageReferenceExtractor] Guild not accessible for message link');
          return null;
        }
      }

      // Try to get channel from cache first (works for regular channels)
      let channel: Channel | null = guild.channels.cache.get(link.channelId) || null;

      // If not in channels cache, it might be a thread - fetch it
      if (!channel) {
        try {
          logger.debug({
            channelId: link.channelId,
            messageId: link.messageId
          }, '[MessageReferenceExtractor] Channel not in cache, fetching...');

          channel = await sourceMessage.client.channels.fetch(link.channelId);

          logger.debug({
            channelId: link.channelId,
            channelType: channel?.type,
            isThread: channel?.isThread?.() || false
          }, '[MessageReferenceExtractor] Channel fetched successfully');
        } catch (fetchError) {
          logger.warn({
            err: fetchError,
            channelId: link.channelId,
            messageId: link.messageId
          }, '[MessageReferenceExtractor] Failed to fetch channel');
          return null;
        }
      }

      if (!channel || !this.isTextBasedChannel(channel)) {
        logger.info({
          channelId: link.channelId,
          hasChannel: !!channel,
          isTextBased: channel?.isTextBased?.() || false,
          hasMessages: channel && 'messages' in channel
        }, '[MessageReferenceExtractor] Channel not text-based or inaccessible');
        return null;
      }

      const fetchedMessage = await (channel as TextChannel | ThreadChannel).messages.fetch(link.messageId);

      logger.info({
        messageId: link.messageId,
        channelId: link.channelId,
        author: fetchedMessage.author.username
      }, '[MessageReferenceExtractor] Successfully fetched message from link');

      return fetchedMessage;
    } catch (error) {
      // Differentiate between expected and unexpected errors
      const discordError = error as any;
      const errorCode = discordError?.code;

      if (errorCode === 10008) {
        // Unknown Message - deleted or never existed (expected)
        logger.debug(`[MessageReferenceExtractor] Message ${link.messageId} not found (deleted or inaccessible)`);
      } else if (errorCode === 50001 || errorCode === 50013) {
        // Missing Access / Missing Permissions (expected)
        logger.debug(`[MessageReferenceExtractor] No permission to access message ${link.messageId}`);
      } else {
        // Unexpected error - log at WARN level for investigation
        logger.warn({
          err: error,
          messageId: link.messageId,
          guildId: link.guildId,
          channelId: link.channelId
        }, '[MessageReferenceExtractor] Unexpected error fetching message from link');
      }
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
    // Extract full Discord environment context (server, category, channel, thread)
    const environment = extractDiscordEnvironment(message);

    // Format location context using the same rich formatter as current messages
    const locationContext = formatEnvironmentForPrompt(environment);

    // Extract regular attachments (files, images, audio, etc.)
    const regularAttachments = extractAttachments(message.attachments);

    // Extract images from embeds (for vision model processing)
    const embedImages = extractEmbedImages(message.embeds);

    // Combine both types of attachments
    const allAttachments = [
      ...(regularAttachments || []),
      ...(embedImages || [])
    ];

    return {
      referenceNumber,
      discordMessageId: message.id,
      webhookId: message.webhookId ?? undefined,
      discordUserId: message.author.id,
      authorUsername: message.author.username,
      authorDisplayName: message.author.displayName ?? message.author.username,
      content: message.content,
      embeds: EmbedParser.parseMessageEmbeds(message),
      timestamp: message.createdAt.toISOString(),
      locationContext,
      attachments: allAttachments.length > 0 ? allAttachments : undefined
    };
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
      logger.debug({
        messageId: message.id,
        author: message.author.username,
        reason: 'exact Discord ID match'
      }, '[MessageReferenceExtractor] Excluding reference - found in conversation history');
      return false; // Exclude - already in conversation history
    }

    logger.debug({
      messageId: message.id,
      author: message.author.username
    }, '[MessageReferenceExtractor] Including reference - not found in conversation history');

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
