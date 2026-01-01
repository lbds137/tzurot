/**
 * Discord Channel Fetcher
 *
 * Fetches recent messages from Discord channels for extended context.
 * Converts Discord messages to ConversationMessage format compatible with the AI pipeline.
 */

import type { Message, TextChannel, DMChannel, NewsChannel, Collection } from 'discord.js';
import { MessageType } from 'discord.js';
import { createLogger, MessageRole, MESSAGE_LIMITS } from '@tzurot/common-types';
import type { ConversationMessage } from '@tzurot/common-types';

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

      // Filter and convert messages
      const messages = this.processMessages(discordMessages, options);

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
   * - Messages with empty content (unless they have attachments)
   *
   * Converts to ConversationMessage format with proper role assignment
   */
  private processMessages(
    messages: Collection<string, Message>,
    options: FetchOptions
  ): ConversationMessage[] {
    const result: ConversationMessage[] = [];

    // Sort by timestamp ascending (oldest first), then reverse for newest first
    const sortedMessages = [...messages.values()].sort(
      (a, b) => a.createdTimestamp - b.createdTimestamp
    );

    for (const msg of sortedMessages) {
      // Skip system messages
      if (!this.isNormalMessage(msg)) {
        continue;
      }

      // Skip empty messages without attachments
      if (!msg.content && msg.attachments.size === 0) {
        continue;
      }

      // Convert to ConversationMessage
      const conversationMessage = this.convertMessage(msg, options);
      if (conversationMessage) {
        result.push(conversationMessage);
      }
    }

    // Return in reverse order (newest first) to match conversation history format
    return result.reverse();
  }

  /**
   * Check if a message is a normal user/bot message (not a system message)
   */
  private isNormalMessage(msg: Message): boolean {
    // Only include DEFAULT and REPLY message types
    return msg.type === MessageType.Default || msg.type === MessageType.Reply;
  }

  /**
   * Convert a Discord message to ConversationMessage format
   */
  private convertMessage(msg: Message, options: FetchOptions): ConversationMessage | null {
    // Determine role based on whether this is from the bot
    const isBot = msg.author.id === options.botUserId;
    const role = isBot ? MessageRole.Assistant : MessageRole.User;

    // Get author display name
    const authorName =
      msg.member?.displayName ?? msg.author.globalName ?? msg.author.username ?? 'Unknown';

    // Build content with author prefix for user messages
    let content = msg.content;
    if (role === MessageRole.User && content) {
      // Prefix user messages with display name for context
      content = `[${authorName}]: ${content}`;
    } else if (role === MessageRole.User && msg.attachments.size > 0) {
      // Handle attachment-only messages
      const attachmentInfo = [...msg.attachments.values()]
        .map(a => `[${a.contentType ?? 'file'}: ${a.name ?? 'attachment'}]`)
        .join(' ');
      content = `[${authorName}]: ${attachmentInfo}`;
    }

    // Skip if we still don't have content
    if (!content) {
      return null;
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
}
