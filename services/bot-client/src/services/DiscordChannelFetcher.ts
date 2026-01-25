/**
 * Discord Channel Fetcher
 *
 * Fetches recent messages from Discord channels for extended context.
 * Converts Discord messages to ConversationMessage format compatible with the AI pipeline.
 *
 * Uses shared MessageContentBuilder to ensure consistency with MessageFormatter
 * (used for referenced messages like message links).
 */

import type { Message, TextChannel, DMChannel, NewsChannel, Collection } from 'discord.js';
import {
  createLogger,
  MessageRole,
  MESSAGE_LIMITS,
  ConversationSyncService,
  stripBotFooters,
} from '@tzurot/common-types';
import type { ConversationMessage, AttachmentMetadata } from '@tzurot/common-types';
import { buildMessageContent, hasMessageContent } from '../utils/MessageContentBuilder.js';
import { isUserContentMessage } from '../utils/messageTypeUtils.js';
import { resolveHistoryLinks } from '../utils/HistoryLinkResolver.js';

const logger = createLogger('DiscordChannelFetcher');

/**
 * Guild member info for participant context
 */
export interface ParticipantGuildInfo {
  roles: string[];
  displayColor?: string;
  joinedAt?: string;
}

/**
 * Result of fetching channel messages
 */
export interface FetchResult {
  /** Messages converted to ConversationMessage format (newest first) */
  messages: ConversationMessage[];
  /** Number of messages fetched from Discord */
  fetchedCount: number;
  /** Number of messages after filtering */
  filteredCount: number;
  /** Raw Discord messages for opportunistic sync (if needed) */
  rawMessages?: Collection<string, Message>;
  /** Image attachments collected from extended context messages (newest first) */
  imageAttachments?: AttachmentMetadata[];
  /** Guild info for participants (keyed by personaId, e.g., 'discord:123456789') */
  participantGuildInfo?: Record<string, ParticipantGuildInfo>;
}

/**
 * Options for fetching channel messages
 */
export interface FetchOptions {
  /** Maximum number of messages to fetch (default: 100) */
  limit?: number;
  /** Message ID to fetch before (excludes this message) */
  before?: string;
  /** Bot's own user ID (to identify assistant messages) */
  botUserId: string;
  /** The personality name (for assistant message attribution) */
  personalityName?: string;
  /** The personality ID (for message tagging) */
  personalityId?: string;
  /** Optional transcript retriever for voice messages */
  getTranscript?: (discordMessageId: string, attachmentUrl: string) => Promise<string | null>;
  /** Whether to resolve Discord message links in history (default: true) */
  resolveLinks?: boolean;
  /** Context epoch - ignore messages before this timestamp (from /history clear) */
  contextEpoch?: Date;
  /** Maximum age in seconds - ignore messages older than this (null = disabled) */
  maxAge?: number | null;
}

/**
 * Channels that support message fetching
 */
export type FetchableChannel = TextChannel | DMChannel | NewsChannel;

/**
 * Fetches and processes Discord channel messages for extended context
 */
export class DiscordChannelFetcher {
  /**
   * Fetch recent messages from a Discord channel
   *
   * @param channel - The Discord channel to fetch from
   * @param options - Fetch options
   * @returns Processed messages in ConversationMessage format
   */
  async fetchRecentMessages(
    channel: FetchableChannel,
    options: FetchOptions
  ): Promise<FetchResult> {
    const limit = options.limit ?? MESSAGE_LIMITS.MAX_EXTENDED_CONTEXT;

    logger.debug(
      {
        channelId: channel.id,
        limit,
        before: options.before,
      },
      '[DiscordChannelFetcher] Fetching channel messages'
    );

    try {
      // Fetch messages from Discord API
      const fetchOptions: { limit: number; before?: string } = { limit };
      if (options.before !== undefined && options.before !== '') {
        fetchOptions.before = options.before;
      }

      const discordMessages = await channel.messages.fetch(fetchOptions);

      // Convert Collection to array for processing
      // Note: Voice transcripts are now handled by TranscriptRetriever in buildMessageContent
      // (single source of truth from DB), not by channel scraping
      let messagesToProcess = [...discordMessages.values()];
      const shouldResolveLinks = options.resolveLinks !== false;

      if (shouldResolveLinks && messagesToProcess.length > 0) {
        const linkResult = await resolveHistoryLinks(messagesToProcess, {
          client: channel.client,
          budget: limit,
        });

        if (linkResult.resolvedCount > 0 || linkResult.trimmedCount > 0) {
          logger.debug(
            {
              channelId: channel.id,
              resolvedCount: linkResult.resolvedCount,
              failedCount: linkResult.failedCount,
              skippedCount: linkResult.skippedCount,
              trimmedCount: linkResult.trimmedCount,
            },
            '[DiscordChannelFetcher] History links resolved'
          );
        }

        messagesToProcess = linkResult.messages;
      }

      // Filter and convert messages (async for transcript retrieval)
      const processResult = await this.processMessages(messagesToProcess, options);

      const participantCount = Object.keys(processResult.participantGuildInfo).length;
      logger.info(
        {
          channelId: channel.id,
          fetchedCount: discordMessages.size,
          filteredCount: processResult.messages.length,
          imageAttachmentCount: processResult.imageAttachments.length,
          participantGuildInfoCount: participantCount,
        },
        '[DiscordChannelFetcher] Fetched and processed channel messages'
      );

      return {
        messages: processResult.messages,
        fetchedCount: discordMessages.size,
        filteredCount: processResult.messages.length,
        rawMessages: discordMessages, // For opportunistic sync
        imageAttachments:
          processResult.imageAttachments.length > 0 ? processResult.imageAttachments : undefined,
        participantGuildInfo: participantCount > 0 ? processResult.participantGuildInfo : undefined,
      };
    } catch (error) {
      logger.error(
        {
          channelId: channel.id,
          error: error instanceof Error ? error.message : String(error),
        },
        '[DiscordChannelFetcher] Failed to fetch channel messages'
      );

      // Return empty result on error (graceful degradation)
      return {
        messages: [],
        fetchedCount: 0,
        filteredCount: 0,
      };
    }
  }

  /**
   * Result of processing messages (internal)
   */
  private processMessagesResult(
    messages: ConversationMessage[],
    imageAttachments: AttachmentMetadata[],
    participantGuildInfo: Record<string, ParticipantGuildInfo>
  ): {
    messages: ConversationMessage[];
    imageAttachments: AttachmentMetadata[];
    participantGuildInfo: Record<string, ParticipantGuildInfo>;
  } {
    return { messages, imageAttachments, participantGuildInfo };
  }

  /**
   * Limit participantGuildInfo to most recent N participants.
   * Relies on ES2015+ object key insertion order guarantee (string keys preserve order).
   * We delete and re-add entries on update to maintain recency ordering.
   */
  private limitParticipants(
    participantGuildInfo: Record<string, ParticipantGuildInfo>
  ): Record<string, ParticipantGuildInfo> {
    const entries = Object.entries(participantGuildInfo);
    if (entries.length <= MESSAGE_LIMITS.MAX_EXTENDED_CONTEXT_PARTICIPANTS) {
      return participantGuildInfo;
    }

    // Keep only the last N entries (most recent participants)
    const limited = entries.slice(-MESSAGE_LIMITS.MAX_EXTENDED_CONTEXT_PARTICIPANTS);
    return Object.fromEntries(limited);
  }

  /**
   * Extract guild member info from a Discord message
   * Used to collect guild info for extended context participants
   */
  private extractGuildInfo(msg: Message): ParticipantGuildInfo {
    const member = msg.member;
    if (!member) {
      return { roles: [] };
    }

    try {
      // Get role names, sorted by position (highest first), excluding @everyone
      const roles =
        member.roles !== undefined
          ? Array.from(member.roles.cache.values())
              .filter(r => r.id !== msg.guild?.id)
              .sort((a, b) => b.position - a.position)
              .slice(0, MESSAGE_LIMITS.MAX_GUILD_ROLES)
              .map(r => r.name)
          : [];

      return {
        roles,
        // Display color from highest colored role (#000000 is treated as transparent)
        displayColor: member.displayHexColor !== '#000000' ? member.displayHexColor : undefined,
        // When user joined the server
        joinedAt: member.joinedAt?.toISOString(),
      };
    } catch (error) {
      // Discord.js can throw when accessing member properties in edge cases
      logger.warn(
        { err: error, memberId: member.id },
        '[DiscordChannelFetcher] Failed to extract guild info, returning empty'
      );
      return { roles: [] };
    }
  }

  /**
   * Process and filter Discord messages
   *
   * Filters:
   * - System messages (joins, boosts, pins, etc.)
   * - Messages with empty content (unless they have attachments/embeds/snapshots)
   *
   * Converts to ConversationMessage format with proper role assignment.
   * Uses shared MessageContentBuilder for consistent message processing.
   * Collects image attachments for extended context processing.
   */
  private async processMessages(
    messages: Message[],
    options: FetchOptions
  ): Promise<{
    messages: ConversationMessage[];
    imageAttachments: AttachmentMetadata[];
    participantGuildInfo: Record<string, ParticipantGuildInfo>;
  }> {
    const result: ConversationMessage[] = [];
    const collectedImageAttachments: AttachmentMetadata[] = [];
    const participantGuildInfo: Record<string, ParticipantGuildInfo> = {};

    // Sort by timestamp ascending (oldest first), then reverse for newest first
    const sortedMessages = [...messages].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    for (const msg of sortedMessages) {
      // Skip system messages (but allow forwarded messages)
      if (!isUserContentMessage(msg)) {
        continue;
      }

      // Skip empty messages (no text, attachments, embeds, or snapshots)
      if (!hasMessageContent(msg)) {
        continue;
      }

      // Skip bot transcript replies - these are replies the bot sends after transcribing
      // a voice message. We don't want them in extended context because:
      // 1. The transcript is already stored in DB and retrieved via TranscriptRetriever
      // 2. Including them would duplicate the transcript content
      // Detection: bot message + reply reference + has text content
      if (this.isBotTranscriptReply(msg, options.botUserId)) {
        continue;
      }

      // Skip messages before context epoch (user has cleared history)
      if (options.contextEpoch !== undefined && msg.createdAt < options.contextEpoch) {
        continue;
      }

      // Skip messages older than maxAge (if configured)
      if (options.maxAge !== undefined && options.maxAge !== null) {
        const cutoffTime = new Date(Date.now() - options.maxAge * 1000);
        if (msg.createdAt < cutoffTime) {
          continue;
        }
      }

      // Convert to ConversationMessage (async for transcript retrieval)
      const conversionResult = await this.convertMessage(msg, options);
      if (conversionResult) {
        result.push(conversionResult.message);
        // Collect image attachments (only images, not voice messages)
        // Add sourceDiscordMessageId to track which message each image came from
        if (conversionResult.attachments.length > 0) {
          const images = conversionResult.attachments
            .filter(a => a.contentType?.startsWith('image/') && a.isVoiceMessage !== true)
            .map(img => ({
              ...img,
              sourceDiscordMessageId: msg.id,
            }));
          collectedImageAttachments.push(...images);
        }

        // Collect guild info for user participants (not bots)
        // Always update to track most recent occurrence (for limiting to most recent N)
        const personaId = conversionResult.message.personaId;
        if (conversionResult.message.role === MessageRole.User && msg.member) {
          // Delete and re-add to move to end of object (maintains recency order)
          delete participantGuildInfo[personaId];
          participantGuildInfo[personaId] = this.extractGuildInfo(msg);
        }
      }
    }

    // Limit to most recent N participants (last entries in object are most recent)
    const limitedParticipantGuildInfo = this.limitParticipants(participantGuildInfo);

    // Return messages in reverse order (newest first) - these get re-sorted chronologically
    // by mergeWithHistory() to optimize for LLM recency bias (newest messages at end of prompt).
    // Image attachments stay in chronological order (oldest message's images first, preserving
    // attachment order within each message) so Image 1 = first attachment, not last
    return this.processMessagesResult(
      result.reverse(),
      collectedImageAttachments,
      limitedParticipantGuildInfo
    );
  }

  /**
   * Check if a message is a bot transcript reply to a voice message
   *
   * Bot transcript replies are messages the bot sends after transcribing a voice message.
   * They're identified by:
   * 1. Being from the bot
   * 2. Being a reply to another message (the voice message)
   * 3. Having text content (the transcript)
   *
   * We filter these out because:
   * - Transcripts are stored in DB and retrieved via TranscriptRetriever
   * - Including them would duplicate content in extended context
   */
  private isBotTranscriptReply(msg: Message, botUserId: string): boolean {
    // Must be from the bot
    if (msg.author.id !== botUserId) {
      return false;
    }

    // Must be a reply to another message
    if (msg.reference?.messageId === undefined) {
      return false;
    }

    // Must have text content (the transcript text)
    if (msg.content.length === 0) {
      return false;
    }

    return true;
  }

  /**
   * Result of converting a single message (internal)
   */
  private convertMessageResult(
    message: ConversationMessage,
    attachments: AttachmentMetadata[]
  ): { message: ConversationMessage; attachments: AttachmentMetadata[] } {
    return { message, attachments };
  }

  /**
   * Convert a Discord message to ConversationMessage format
   *
   * Uses shared MessageContentBuilder for comprehensive content extraction,
   * ensuring consistency with MessageFormatter (used for referenced messages).
   * Returns both the converted message and any attachments for collection.
   */
  private async convertMessage(
    msg: Message,
    options: FetchOptions
  ): Promise<{ message: ConversationMessage; attachments: AttachmentMetadata[] } | null> {
    // Determine role based on whether this is from the bot
    const isBot = msg.author.id === options.botUserId;
    const role = isBot ? MessageRole.Assistant : MessageRole.User;

    // Get author display name
    const authorName =
      msg.member?.displayName ?? msg.author.globalName ?? msg.author.username ?? 'Unknown';

    // Build comprehensive content using shared utility
    // This includes: text, embeds, voice transcripts, forwarded content
    // Note: includeAttachments is false because image descriptions are added via XML
    // <image_descriptions> element after preprocessing - no need to duplicate metadata
    const {
      content: rawContent,
      isForwarded,
      attachments,
    } = await buildMessageContent(msg, {
      includeEmbeds: true,
      includeAttachments: false,
      getTranscript: options.getTranscript,
    });

    // Skip if no content and no attachments (nothing to process)
    // Messages with only attachments are kept for vision processing
    if (!rawContent && attachments.length === 0) {
      return null;
    }

    // Build final content - no prefix needed since XML format uses from="Name" attribute
    // isForwarded flag is passed separately for XML attribute formatting
    const content = rawContent;

    const message: ConversationMessage = {
      // Use Discord message ID as the conversation ID
      // This ensures uniqueness and allows deduplication with DB history
      id: msg.id,
      role,
      content,
      createdAt: msg.createdAt,
      // Extended context persona ID format: 'discord:{discordUserId}'
      // This is intentionally NOT a UUID - extended context participants are transient:
      // - Not stored in database (no persona record exists)
      // - Used only for prompt ID binding (linking <participant> to <message from_id>)
      // - Used as key for participantGuildInfo lookup
      // DB history participants use proper UUID persona IDs from the database.
      personaId: role === MessageRole.User ? `discord:${msg.author.id}` : 'assistant',
      personaName: role === MessageRole.User ? authorName : options.personalityName,
      discordUsername: msg.author.username,
      discordMessageId: [msg.id],
      // Forwarded messages use XML attribute instead of content prefix
      isForwarded: isForwarded || undefined,
      // No token count - will be computed if needed
    };

    return this.convertMessageResult(message, attachments);
  }

  /**
   * Merge extended context messages with database conversation history
   *
   * This handles deduplication when the same message appears in both sources.
   * Priority: DB history (more complete metadata) > Discord fetch
   *
   * @param extendedMessages - Messages from Discord channel fetch
   * @param dbHistory - Messages from database conversation history (chronological order)
   * @returns Merged and deduplicated message list in chronological order (oldest first)
   */
  mergeWithHistory(
    extendedMessages: ConversationMessage[],
    dbHistory: ConversationMessage[]
  ): ConversationMessage[] {
    // Build set of message IDs from DB history for deduplication
    const dbMessageIds = new Set<string>();
    for (const msg of dbHistory) {
      for (const id of msg.discordMessageId) {
        dbMessageIds.add(id);
      }
    }

    // Filter extended messages to exclude those already in DB history
    const uniqueExtendedMessages = extendedMessages.filter(msg => {
      const msgId = msg.discordMessageId[0];
      return !dbMessageIds.has(msgId);
    });

    logger.debug(
      {
        extendedCount: extendedMessages.length,
        dbHistoryCount: dbHistory.length,
        uniqueExtendedCount: uniqueExtendedMessages.length,
        deduplicatedCount: extendedMessages.length - uniqueExtendedMessages.length,
      },
      '[DiscordChannelFetcher] Merged extended context with DB history'
    );

    // Combine: DB history (chronological, richer metadata) + unique extended messages
    const merged = [...dbHistory, ...uniqueExtendedMessages];

    // Sort by timestamp ascending (oldest first = chronological order)
    // This ensures newest messages appear last in the prompt, getting
    // more attention from LLMs due to recency bias in attention mechanisms
    merged.sort((a, b) => {
      const timeA =
        a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
      const timeB =
        b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
      return timeA - timeB;
    });

    return merged;
  }

  // ============================================================================
  // Opportunistic Sync Methods
  // ============================================================================

  /**
   * Perform opportunistic sync between Discord messages and database
   *
   * Detects:
   * - Edits: Discord message content differs from DB
   * - Deletes: Message in DB but not in Discord fetch (within time window)
   *
   * @param discordMessages - Raw Discord messages from fetch
   * @param channelId - Channel ID
   * @param personalityId - Personality ID to filter DB messages
   * @param conversationSync - Service to perform sync operations
   * @returns Sync result with counts of edits and deletes
   */
  async syncWithDatabase(
    discordMessages: Collection<string, Message>,
    channelId: string,
    personalityId: string,
    conversationSync: ConversationSyncService
  ): Promise<SyncResult> {
    const result: SyncResult = { updated: 0, deleted: 0 };

    try {
      // Get Discord message IDs for lookup
      const discordMessageIds = [...discordMessages.keys()];
      if (discordMessageIds.length === 0) {
        return result;
      }

      // Look up these messages in the database
      const dbMessages = await conversationSync.getMessagesByDiscordIds(
        discordMessageIds,
        channelId,
        personalityId
      );

      if (dbMessages.size === 0) {
        logger.debug(
          { channelId, discordCount: discordMessageIds.length },
          '[DiscordChannelFetcher] No matching DB messages for sync'
        );
        return result;
      }

      // Check for edits - group Discord messages by their DB record first
      // This handles chunked messages correctly (one DB record -> multiple Discord messages)
      const dbRecordToChunks = new Map<
        string,
        { dbMsg: typeof dbMessages extends Map<string, infer V> ? V : never; chunks: Message[] }
      >();

      for (const [discordId, discordMsg] of discordMessages) {
        const dbMsg = dbMessages.get(discordId);
        if (dbMsg?.deletedAt === null) {
          const existing = dbRecordToChunks.get(dbMsg.id);
          if (existing) {
            existing.chunks.push(discordMsg);
          } else {
            dbRecordToChunks.set(dbMsg.id, { dbMsg, chunks: [discordMsg] });
          }
        }
      }

      // Process each unique DB record
      for (const [dbId, { dbMsg, chunks }] of dbRecordToChunks) {
        // Sort chunks by their order in the DB's discordMessageId array
        const orderMap = new Map(dbMsg.discordMessageId.map((id, idx) => [id, idx]));
        chunks.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));

        // Concatenate all chunk contents
        let collatedContent = chunks.map(c => c.content).join('');

        // Strip bot-added footer lines (model indicator, guest mode, auto-response)
        // These are for Discord display only and NOT stored in the database
        collatedContent = stripBotFooters(collatedContent);

        // Compare and update
        if (this.contentsDiffer(collatedContent, dbMsg.content)) {
          const updated = await conversationSync.updateMessageContent(dbId, collatedContent);
          if (updated) {
            result.updated++;
            logger.debug(
              { messageId: dbId, chunkCount: chunks.length },
              '[DiscordChannelFetcher] Synced edited message'
            );
          }
        }
      }

      // Check for deletes - find DB messages that should be in Discord but aren't
      // Only check messages within the fetch window (oldest Discord message timestamp)
      const oldestDiscordTime = this.getOldestTimestamp(discordMessages);
      if (oldestDiscordTime) {
        const dbMessagesInWindow = await conversationSync.getMessagesInTimeWindow(
          channelId,
          personalityId,
          oldestDiscordTime
        );

        const discordIdSet = new Set(discordMessageIds);
        const deletedMessageIds: string[] = [];

        for (const dbMsg of dbMessagesInWindow) {
          // Check if any of this message's Discord IDs are in the fetch
          const hasMatchingDiscordId = dbMsg.discordMessageId.some((id: string) =>
            discordIdSet.has(id)
          );
          if (!hasMatchingDiscordId) {
            // Message is in DB but not in Discord - it was deleted
            deletedMessageIds.push(dbMsg.id);
          }
        }

        if (deletedMessageIds.length > 0) {
          const deleteCount = await conversationSync.softDeleteMessages(deletedMessageIds);
          result.deleted = deleteCount;
          logger.info(
            { channelId, deletedCount: deleteCount },
            '[DiscordChannelFetcher] Soft deleted messages not found in Discord'
          );
        }
      }

      if (result.updated > 0 || result.deleted > 0) {
        logger.info(
          { channelId, personalityId, updated: result.updated, deleted: result.deleted },
          '[DiscordChannelFetcher] Opportunistic sync completed'
        );
      }

      return result;
    } catch (error) {
      logger.error(
        { channelId, personalityId, error: error instanceof Error ? error.message : String(error) },
        '[DiscordChannelFetcher] Sync failed'
      );
      return result;
    }
  }

  /**
   * Check if two message contents differ significantly
   * Handles the case where DB content may have display name prefix
   */
  private contentsDiffer(discordContent: string, dbContent: string): boolean {
    // Direct comparison first
    if (discordContent === dbContent) {
      return false;
    }

    // Check if DB content is the Discord content with a [Name]: prefix
    // Pattern: [DisplayName]: <actual content>
    const prefixRegex = /^\[.+?\]: (.*)$/s;
    const prefixMatch = prefixRegex.exec(dbContent);
    if (prefixMatch !== null) {
      const dbContentWithoutPrefix = prefixMatch[1];
      if (discordContent === dbContentWithoutPrefix) {
        return false; // Same content, just has display name prefix
      }
    }

    // Contents actually differ
    return true;
  }

  /**
   * Get the oldest timestamp from a collection of Discord messages
   */
  private getOldestTimestamp(messages: Collection<string, Message>): Date | null {
    let oldest: Date | null = null;
    for (const msg of messages.values()) {
      if (oldest === null || msg.createdAt < oldest) {
        oldest = msg.createdAt;
      }
    }
    return oldest;
  }
}

/**
 * Result of opportunistic database sync
 */
export interface SyncResult {
  /** Number of messages updated (edits detected) */
  updated: number;
  /** Number of messages soft-deleted (deletes detected) */
  deleted: number;
}
