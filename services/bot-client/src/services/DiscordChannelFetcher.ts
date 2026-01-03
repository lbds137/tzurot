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
import { MessageType, MessageReferenceType } from 'discord.js';
import {
  createLogger,
  MessageRole,
  MESSAGE_LIMITS,
  ConversationSyncService,
} from '@tzurot/common-types';
import type { ConversationMessage } from '@tzurot/common-types';
import { buildMessageContent, hasMessageContent } from '../utils/MessageContentBuilder.js';
import { mergeVoiceContext } from '../utils/VoiceContextMerger.js';
import { resolveHistoryLinks } from '../utils/HistoryLinkResolver.js';

const logger = createLogger('DiscordChannelFetcher');

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

      // Merge voice message transcripts using the Reverse Zipper algorithm
      // This injects transcript text into voice messages and removes bot transcript replies
      const mergeResult = mergeVoiceContext(discordMessages, options.botUserId);

      if (mergeResult.mergedCount > 0 || mergeResult.orphanTranscripts > 0) {
        logger.debug(
          {
            channelId: channel.id,
            mergedCount: mergeResult.mergedCount,
            unmergedCount: mergeResult.unmergedCount,
            orphanTranscripts: mergeResult.orphanTranscripts,
          },
          '[DiscordChannelFetcher] Voice context merged'
        );
      }

      // Resolve Discord message links in history (if enabled)
      // This injects linked message content inline and manages the budget
      let messagesToProcess = mergeResult.messages;
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
      const messages = await this.processMessages(messagesToProcess, options);

      logger.info(
        {
          channelId: channel.id,
          fetchedCount: discordMessages.size,
          filteredCount: messages.length,
        },
        '[DiscordChannelFetcher] Fetched and processed channel messages'
      );

      return {
        messages,
        fetchedCount: discordMessages.size,
        filteredCount: messages.length,
        rawMessages: discordMessages, // For opportunistic sync
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
   * Process and filter Discord messages
   *
   * Filters:
   * - System messages (joins, boosts, pins, etc.)
   * - Messages with empty content (unless they have attachments/embeds/snapshots)
   *
   * Converts to ConversationMessage format with proper role assignment.
   * Uses shared MessageContentBuilder for consistent message processing.
   */
  private async processMessages(
    messages: Message[],
    options: FetchOptions
  ): Promise<ConversationMessage[]> {
    const result: ConversationMessage[] = [];

    // Sort by timestamp ascending (oldest first), then reverse for newest first
    const sortedMessages = [...messages].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    for (const msg of sortedMessages) {
      // Skip system messages (but allow forwarded messages)
      if (!this.isNormalMessage(msg)) {
        continue;
      }

      // Skip empty messages (no text, attachments, embeds, or snapshots)
      if (!hasMessageContent(msg)) {
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
      const conversationMessage = await this.convertMessage(msg, options);
      if (conversationMessage) {
        result.push(conversationMessage);
      }
    }

    // Return in reverse order (newest first) to match conversation history format
    return result.reverse();
  }

  /**
   * Check if a message is a normal user/bot message (not a system message)
   *
   * Includes:
   * - Default messages
   * - Reply messages
   * - Forwarded messages (detected via reference type, not message type)
   */
  private isNormalMessage(msg: Message): boolean {
    // Allow DEFAULT and REPLY message types
    if (msg.type === MessageType.Default || msg.type === MessageType.Reply) {
      return true;
    }

    // Also allow forwarded messages (have Forward reference type with snapshots)
    if (
      msg.reference?.type === MessageReferenceType.Forward &&
      msg.messageSnapshots !== undefined &&
      msg.messageSnapshots.size > 0
    ) {
      return true;
    }

    return false;
  }

  /**
   * Convert a Discord message to ConversationMessage format
   *
   * Uses shared MessageContentBuilder for comprehensive content extraction,
   * ensuring consistency with MessageFormatter (used for referenced messages).
   */
  private async convertMessage(
    msg: Message,
    options: FetchOptions
  ): Promise<ConversationMessage | null> {
    // Determine role based on whether this is from the bot
    const isBot = msg.author.id === options.botUserId;
    const role = isBot ? MessageRole.Assistant : MessageRole.User;

    // Get author display name
    const authorName =
      msg.member?.displayName ?? msg.author.globalName ?? msg.author.username ?? 'Unknown';

    // Build comprehensive content using shared utility
    // This includes: text, attachments, embeds, voice transcripts, forwarded content
    const { content: rawContent, isForwarded } = await buildMessageContent(msg, {
      includeEmbeds: true,
      includeAttachments: true,
      getTranscript: options.getTranscript,
    });

    // Skip if no content could be extracted
    if (!rawContent) {
      return null;
    }

    // Build final content with author prefix for user messages
    let content: string;
    if (role === MessageRole.User) {
      // Prefix user messages with display name for context
      const forwardedIndicator = isForwarded ? ' (forwarded)' : '';
      content = `[${authorName}${forwardedIndicator}]: ${rawContent}`;
    } else {
      content = rawContent;
    }

    return {
      // Use Discord message ID as the conversation ID
      // This ensures uniqueness and allows deduplication with DB history
      id: msg.id,
      role,
      content,
      createdAt: msg.createdAt,
      // For extended context messages, use a placeholder persona ID
      // These are transient and not stored in the database
      personaId: role === MessageRole.User ? `discord:${msg.author.id}` : 'assistant',
      personaName: role === MessageRole.User ? authorName : options.personalityName,
      discordUsername: msg.author.username,
      discordMessageId: [msg.id],
      // No token count - will be computed if needed
    };
  }

  /**
   * Merge extended context messages with database conversation history
   *
   * This handles deduplication when the same message appears in both sources.
   * Priority: DB history (more complete metadata) > Discord fetch
   *
   * @param extendedMessages - Messages from Discord channel fetch
   * @param dbHistory - Messages from database conversation history
   * @returns Merged and deduplicated message list (newest first)
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

    // Combine: DB history first (these have richer metadata), then unique extended
    // Both are already sorted newest-first, so we merge by timestamp
    const merged = [...dbHistory, ...uniqueExtendedMessages];

    // Sort by timestamp descending (newest first)
    merged.sort((a, b) => {
      const timeA =
        a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
      const timeB =
        b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
      return timeB - timeA;
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

      // Check for edits
      for (const [discordId, discordMsg] of discordMessages) {
        const dbMsg = dbMessages.get(discordId);
        if (dbMsg?.deletedAt === null) {
          // Message exists in both - check for edit
          // Note: Discord content may have prefix from our conversion, so we compare raw content
          const discordContent = discordMsg.content;
          // DB content might have [DisplayName]: prefix, extract the raw part for comparison
          // This is a heuristic - we check if content has changed significantly
          if (this.contentsDiffer(discordContent, dbMsg.content)) {
            // Update the message content in DB
            const updated = await conversationSync.updateMessageContent(dbMsg.id, discordContent);
            if (updated) {
              result.updated++;
              logger.debug(
                { messageId: dbMsg.id, discordId },
                '[DiscordChannelFetcher] Synced edited message'
              );
            }
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
