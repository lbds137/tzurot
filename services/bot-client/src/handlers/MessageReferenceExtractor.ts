/**
 * Message Reference Extractor
 *
 * Extracts and formats referenced messages from replies and message links
 */

import {
  Message,
  TextChannel,
  ThreadChannel,
  Channel,
  MessageReferenceType,
  MessageSnapshot,
  APIEmbed,
} from 'discord.js';
import { MessageLinkParser, ParsedMessageLink } from '../utils/MessageLinkParser.js';
import { EmbedParser } from '../utils/EmbedParser.js';
import { extractAttachments } from '../utils/attachmentExtractor.js';
import { extractEmbedImages } from '../utils/embedImageExtractor.js';
import { createLogger, INTERVALS, ReferencedMessage } from '@tzurot/common-types';
import { extractDiscordEnvironment, formatEnvironmentForPrompt } from '../utils/discordContext.js';
import { getVoiceTranscript } from '../redis.js';
import { ConversationHistoryService } from '@tzurot/common-types';

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

  constructor(options: ReferenceExtractionOptions = {}) {
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
    this.embedProcessingDelayMs = options.embedProcessingDelayMs ?? INTERVALS.EMBED_PROCESSING_DELAY;
    this.conversationHistoryMessageIds = new Set(options.conversationHistoryMessageIds ?? []);
    this.conversationHistoryTimestamps = options.conversationHistoryTimestamps ?? [];
    this.conversationHistoryService = new ConversationHistoryService();
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
              const snapshotRef = this.formatSnapshot(snapshot, snapshotNumber, referencedMessage);
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
            const replyReference = await this.formatReferencedMessage(referencedMessage, 1);
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
    const { MessageReferenceType } = await import('discord.js');
    const links = MessageLinkParser.parseMessageLinks(message.content);
    const references: ReferencedMessage[] = [];
    const linkMap = new Map<string, number>(); // Map Discord URL to reference number

    let currentNumber = startNumber;

    for (const link of links) {
      const referencedMessage = await this.fetchMessageFromLink(link, message);
      if (referencedMessage) {
        // Skip if this exact message was already extracted (e.g., from reply)
        if (extractedMessageIds.has(referencedMessage.id)) {
          logger.debug(
            `[MessageReferenceExtractor] Skipping duplicate link reference ${referencedMessage.id} - already extracted from reply`
          );
          continue;
        }

        // Skip if message is already in conversation history
        if (!this.shouldIncludeReference(referencedMessage)) {
          logger.debug(
            `[MessageReferenceExtractor] Skipping link reference ${referencedMessage.id} - already in conversation history`
          );
          continue;
        }

        // Check if this is a forwarded message with snapshots
        if (
          referencedMessage.reference?.type === MessageReferenceType.Forward &&
          referencedMessage.messageSnapshots?.size
        ) {
          // Extract each snapshot from the forward
          for (const snapshot of referencedMessage.messageSnapshots.values()) {
            const snapshotReference = this.formatSnapshot(
              snapshot,
              currentNumber,
              referencedMessage
            );
            references.push(snapshotReference);
            linkMap.set(link.fullUrl, currentNumber);
            currentNumber++;

            logger.info(
              {
                messageId: referencedMessage.id,
                snapshotContent: snapshot.content?.substring(0, 50),
                referenceNumber: currentNumber - 1,
              },
              '[MessageReferenceExtractor] Added snapshot from linked forward'
            );
          }

          extractedMessageIds.add(referencedMessage.id);
        } else {
          // Regular message (not a forward)
          references.push(await this.formatReferencedMessage(referencedMessage, currentNumber));
          linkMap.set(link.fullUrl, currentNumber);
          extractedMessageIds.add(referencedMessage.id);
          currentNumber++;
        }
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
          logger.debug(
            {
              guildId: link.guildId,
              messageId: link.messageId,
            },
            '[MessageReferenceExtractor] Guild not in cache, attempting fetch...'
          );

          guild = await sourceMessage.client.guilds.fetch(link.guildId);

          logger.info(
            {
              guildId: link.guildId,
              guildName: guild.name,
            },
            '[MessageReferenceExtractor] Successfully fetched guild'
          );
        } catch (fetchError) {
          logger.info(
            {
              guildId: link.guildId,
              messageId: link.messageId,
              err: fetchError,
            },
            '[MessageReferenceExtractor] Guild not accessible for message link'
          );
          return null;
        }
      }

      // Try to get channel from cache first (works for regular channels)
      let channel: Channel | null = guild.channels.cache.get(link.channelId) ?? null;

      // If not in channels cache, it might be a thread - fetch it
      if (!channel) {
        try {
          logger.debug(
            {
              channelId: link.channelId,
              messageId: link.messageId,
            },
            '[MessageReferenceExtractor] Channel not in cache, fetching...'
          );

          channel = await sourceMessage.client.channels.fetch(link.channelId);

          logger.debug(
            {
              channelId: link.channelId,
              channelType: channel?.type,
              isThread: (channel?.isThread?.() ?? false) === true,
            },
            '[MessageReferenceExtractor] Channel fetched successfully'
          );
        } catch (fetchError) {
          logger.warn(
            {
              err: fetchError,
              channelId: link.channelId,
              messageId: link.messageId,
            },
            '[MessageReferenceExtractor] Failed to fetch channel'
          );
          return null;
        }
      }

      if (!channel || !this.isTextBasedChannel(channel)) {
        logger.info(
          {
            channelId: link.channelId,
            hasChannel: channel !== null && channel !== undefined,
            isTextBased: (channel?.isTextBased?.() ?? false) === true,
            hasMessages: channel !== null && channel !== undefined && 'messages' in channel,
          },
          '[MessageReferenceExtractor] Channel not text-based or inaccessible'
        );
        return null;
      }

      const fetchedMessage = await (channel as TextChannel | ThreadChannel).messages.fetch(
        link.messageId
      );

      logger.info(
        {
          messageId: link.messageId,
          channelId: link.channelId,
          author: fetchedMessage.author.username,
        },
        '[MessageReferenceExtractor] Successfully fetched message from link'
      );

      return fetchedMessage;
    } catch (error) {
      // Differentiate between expected and unexpected errors
      const discordError = error as Error & { code?: number };
      const errorCode = discordError.code;

      if (errorCode === 10008) {
        // Unknown Message - deleted or never existed (expected)
        logger.debug(
          `[MessageReferenceExtractor] Message ${link.messageId} not found (deleted or inaccessible)`
        );
      } else if (errorCode === 50001 || errorCode === 50013) {
        // Missing Access / Missing Permissions (expected)
        logger.debug(
          `[MessageReferenceExtractor] No permission to access message ${link.messageId}`
        );
      } else {
        // Unexpected error - log at WARN level for investigation
        logger.warn(
          {
            err: error,
            messageId: link.messageId,
            guildId: link.guildId,
            channelId: link.channelId,
          },
          '[MessageReferenceExtractor] Unexpected error fetching message from link'
        );
      }
      return null;
    }
  }

  /**
   * Format a Discord message as a referenced message
   * @param message - Discord message
   * @param referenceNumber - Reference number
   * @param isForwarded - Whether this is a forwarded message snapshot
   * @returns Formatted referenced message
   */
  private async formatReferencedMessage(
    message: Message,
    referenceNumber: number,
    isForwarded?: boolean
  ): Promise<ReferencedMessage> {
    // Extract full Discord environment context (server, category, channel, thread)
    const environment = extractDiscordEnvironment(message);

    // Format location context using the same rich formatter as current messages
    const locationContext = formatEnvironmentForPrompt(environment);

    // Extract regular attachments (files, images, audio, etc.)
    const regularAttachments = extractAttachments(message.attachments);

    // Extract images from embeds (for vision model processing)
    const embedImages = extractEmbedImages(message.embeds);

    // Combine both types of attachments
    const allAttachments = [...(regularAttachments ?? []), ...(embedImages ?? [])];

    // Check if any attachments are voice messages with transcripts (Redis cache or database)
    let contentWithTranscript = message.content;
    if (regularAttachments && regularAttachments.length > 0) {
      const transcripts: string[] = [];

      for (const attachment of regularAttachments) {
        if (
          attachment.isVoiceMessage !== undefined &&
          attachment.isVoiceMessage !== null &&
          attachment.isVoiceMessage === true
        ) {
          const transcript = await this.retrieveVoiceTranscript(message.id, attachment.url);
          if (
            transcript !== undefined &&
            transcript !== null &&
            transcript.length > 0
          ) {
            transcripts.push(transcript);
          }
        }
      }

      // Append transcripts to content if found
      if (transcripts.length > 0) {
        const transcriptText = transcripts.join('\n\n');
        contentWithTranscript = message.content
          ? `${message.content}\n\n[Voice transcript]: ${transcriptText}`
          : `[Voice transcript]: ${transcriptText}`;
      }
    }

    return {
      referenceNumber,
      discordMessageId: message.id,
      webhookId: message.webhookId ?? undefined,
      discordUserId: message.author.id,
      authorUsername: message.author.username,
      authorDisplayName: message.author.displayName ?? message.author.username,
      content: contentWithTranscript,
      embeds: EmbedParser.parseMessageEmbeds(message),
      timestamp: message.createdAt.toISOString(),
      locationContext,
      attachments: allAttachments.length > 0 ? allAttachments : undefined,
      isForwarded: isForwarded ?? undefined,
    };
  }

  /**
   * Format a MessageSnapshot as a referenced message
   * Snapshots are created when messages are forwarded - they don't include author info
   * @param snapshot - Discord message snapshot
   * @param referenceNumber - Reference number
   * @param forwardedFrom - Original message that contained this snapshot
   * @returns Formatted referenced message with isForwarded flag
   */
  private formatSnapshot(
    snapshot: MessageSnapshot,
    referenceNumber: number,
    forwardedFrom: Message
  ): ReferencedMessage {
    // Extract location context from the forwarding message (since snapshot doesn't have it)
    const environment = extractDiscordEnvironment(forwardedFrom);
    const locationContext = formatEnvironmentForPrompt(environment);

    // Process regular attachments from snapshot
    const regularAttachments =
      snapshot.attachments !== undefined && snapshot.attachments !== null
        ? extractAttachments(snapshot.attachments)
        : undefined;

    // Extract images from snapshot embeds (for vision model processing)
    const embedImages = extractEmbedImages(snapshot.embeds);

    // Combine both types of attachments
    const allAttachments = [
      ...(regularAttachments ?? []),
      ...(embedImages ?? []),
    ];

    // Process embeds from snapshot
    const embedString =
      snapshot.embeds !== undefined &&
      snapshot.embeds !== null &&
      snapshot.embeds.length > 0
        ? snapshot.embeds
            .map((embed, index) => {
              const embedNumber = snapshot.embeds.length > 1 ? ` ${index + 1}` : '';
              // Convert embed to APIEmbed format (some embeds need .toJSON(), snapshots already have it as plain object)
              const apiEmbed: APIEmbed =
                'toJSON' in embed && typeof embed.toJSON === 'function'
                  ? (embed.toJSON() as APIEmbed)
                  : (embed as APIEmbed);
              return `### Embed${embedNumber}\n\n${EmbedParser.parseEmbed(apiEmbed)}`;
            })
            .join('\n\n---\n\n')
        : '';

    return {
      referenceNumber,
      discordMessageId: forwardedFrom.id, // Use forward message ID (snapshot doesn't have its own)
      webhookId: undefined,
      discordUserId: 'unknown', // Snapshots don't include author info
      authorUsername: 'Unknown User',
      authorDisplayName: 'Unknown User',
      content: snapshot.content || '',
      embeds: embedString,
      timestamp: snapshot.createdTimestamp
        ? new Date(snapshot.createdTimestamp).toISOString()
        : forwardedFrom.createdAt.toISOString(),
      locationContext: `${locationContext} (forwarded message)`,
      attachments: allAttachments.length > 0 ? allAttachments : undefined,
      isForwarded: true,
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
   * Retrieve voice transcript with two-tier lookup
   *
   * Tier 1 (Fast): Redis cache (5-minute TTL for recent messages)
   * Tier 2 (Permanent): Database lookup by Discord message ID
   *
   * This ensures transcripts are available forever, not just for 5 minutes.
   *
   * @param discordMessageId - Discord message ID
   * @param attachmentUrl - Voice attachment CDN URL
   * @returns Transcript text or null if not found
   */
  private async retrieveVoiceTranscript(
    discordMessageId: string,
    attachmentUrl: string
  ): Promise<string | null> {
    try {
      // Tier 1: Check Redis cache (fast path for recent messages)
      const cachedTranscript = await getVoiceTranscript(attachmentUrl);
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
          '[MessageReferenceExtractor] Retrieved voice transcript from Redis cache'
        );
        return cachedTranscript;
      }

      // Tier 2: Check database (permanent storage)
      // Voice transcripts are stored as the message content in conversation history
      const dbMessage = await this.conversationHistoryService.getMessageByDiscordId(
        discordMessageId
      );

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
          '[MessageReferenceExtractor] Retrieved voice transcript from database'
        );
        return dbMessage.content;
      }

      logger.debug(
        {
          messageId: discordMessageId,
          attachmentUrl: attachmentUrl.substring(0, 50),
        },
        '[MessageReferenceExtractor] No transcript found in cache or database'
      );
      return null;
    } catch (error) {
      logger.warn(
        {
          err: error,
          messageId: discordMessageId,
          attachmentUrl: attachmentUrl.substring(0, 50),
        },
        '[MessageReferenceExtractor] Error retrieving voice transcript'
      );
      return null;
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
