/**
 * ConversationHistoryService
 * Manages short-term conversation history in PostgreSQL (CRUD and query operations)
 *
 * Related services:
 * - ConversationRetentionService: Cleanup and retention policies
 * - ConversationSyncService: Opportunistic sync with Discord (edit/delete detection)
 * - ConversationMessageMapper: Data transformation
 */

import { MessageRole } from '@tzurot/common-types/constants/message';
import { computeHistoryCutoff } from '@tzurot/common-types/services/historyCutoff';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  type ConversationMessage,
  type CrossChannelHistoryGroup,
} from '@tzurot/common-types/types/conversationMessage';
import { type MessageMetadata } from '@tzurot/common-types/types/schemas/message';
import { generateConversationHistoryUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { countTextTokens } from '@tzurot/common-types/utils/tokenCounter';
import {
  conversationHistorySelect,
  conversationRecencyOrderBy,
  mapToConversationMessage,
  mapToConversationMessages,
} from './ConversationMessageMapper.js';
import { writeReferenceImageDescriptions } from './referenceImageDescriptions.js';

const logger = createLogger('ConversationHistoryService');

/**
 * Optional time-bound filters for history fetches. Kept as a sub-options
 * object so adding a new filter (e.g., per-personality scope) doesn't push
 * `getChannelHistory` / `getCrossChannelHistory` past the max-params limit.
 */
export interface HistoryTimeFilter {
  /** Max-age cutoff in SECONDS (matches DiscordChannelFetcher's unit). */
  maxAgeSeconds?: number | null;
  /** Explicit reset point — e.g., from `/conversation reset`. */
  contextEpoch?: Date;
}

/**
 * Options for adding a message to conversation history
 */
interface AddMessageOptions {
  /** Discord channel ID */
  channelId: string;
  /** Personality ID */
  personalityId: string;
  /** User's persona ID */
  personaId: string;
  /** Message role (user or assistant) */
  role: MessageRole;
  /** Message content */
  content: string;
  /** Discord guild ID (null for DMs). Required to explicitly handle DM vs guild context. */
  guildId: string | null;
  /**
   * Discord message ID(s). Can be:
   * - string: single message ID (user messages, single-chunk assistant messages)
   * - string[]: multiple message IDs (chunked assistant messages)
   * - undefined: no Discord message ID yet
   */
  discordMessageId?: string | string[];
  /**
   * Optional timestamp for the message. If provided, overrides the default
   * PostgreSQL timestamp. Used to maintain chronological ordering when
   * creating assistant messages after Discord send completes.
   */
  timestamp?: Date;
  /** Optional structured metadata (referenced messages, attachment descriptions) */
  messageMetadata?: MessageMetadata;
}

export class ConversationHistoryService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Add a message to conversation history
   */
  async addMessage(options: AddMessageOptions): Promise<void> {
    const {
      channelId,
      personalityId,
      personaId,
      role,
      content,
      guildId,
      discordMessageId,
      timestamp,
      messageMetadata,
    } = options;

    try {
      // Normalize discordMessageId to array format
      const messageIds =
        discordMessageId !== undefined
          ? Array.isArray(discordMessageId)
            ? discordMessageId
            : [discordMessageId]
          : [];

      // Compute token count once and cache it
      // This prevents recomputing on every AI request (web Claude optimization)
      const tokenCount = countTextTokens(content);

      // Generate deterministic UUID for conversation history
      // Use personaId as the user identifier since it's unique per user+personality
      const createdAt = timestamp ?? new Date();
      const id = generateConversationHistoryUuid(channelId, personalityId, personaId, createdAt);

      await this.prisma.conversationHistory.create({
        data: {
          id,
          channelId,
          guildId: guildId ?? null,
          personalityId,
          personaId,
          role,
          content,
          tokenCount, // Cache token count for performance
          discordMessageId: messageIds,
          createdAt,
          // Store structured metadata (referenced messages, attachments)
          ...(messageMetadata !== undefined && { messageMetadata }),
        },
      });

      logger.debug(
        {
          role,
          channelId,
          guildId: guildId ?? 'DM',
          personalityId,
          personaIdPrefix: personaId.substring(0, 8),
          discordIdCount: messageIds.length,
          timestampKind: timestamp !== undefined ? 'explicit' : 'default',
          tokenCount,
          hasMetadata: messageMetadata !== undefined,
        },
        'Added message to history'
      );
    } catch (error) {
      logger.error({ err: error }, 'Failed to add message to conversation history');
      throw error;
    }
  }

  /**
   * Update the most recent message for a persona in a channel
   * Used to enrich user messages with attachment descriptions after AI processing
   *
   * @param newContent Updated plain text content (user message + attachment descriptions)
   * @param newMetadata Optional updated metadata (with processed attachment descriptions)
   */
  async updateLastUserMessage(
    channelId: string,
    personalityId: string,
    personaId: string,
    newContent: string,
    newMetadata?: MessageMetadata
  ): Promise<boolean> {
    try {
      // Find the most recent user message for this persona
      const lastMessage = await this.prisma.conversationHistory.findFirst({
        where: {
          channelId,
          personalityId,
          personaId,
          role: MessageRole.User,
        },
        // id tiebreak so a createdAt-ms tie deterministically resolves to one
        // row — this then drives an update() on lastMessage.id below.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });

      if (!lastMessage) {
        logger.warn(
          {},
          `No user message found to update (channel: ${channelId}, personality: ${personalityId}, persona: ${personaId.substring(0, 8)}...)`
        );
        return false;
      }

      // Recompute token count for enriched content
      const tokenCount = countTextTokens(newContent);

      // Merge new metadata fields onto the existing row metadata (don't clobber
      // embedsXml/referencedMessages/etc. that were persisted at message creation).
      const mergedMetadata =
        newMetadata !== undefined
          ? { ...((lastMessage.messageMetadata as MessageMetadata | null) ?? {}), ...newMetadata }
          : undefined;

      // Update the content, token count, and optionally metadata
      await this.prisma.conversationHistory.update({
        where: {
          id: lastMessage.id,
        },
        data: {
          content: newContent,
          tokenCount, // Update token count to match enriched content
          ...(mergedMetadata !== undefined && { messageMetadata: mergedMetadata }),
        },
      });

      logger.debug(
        { messageId: lastMessage.id, tokenCount, hasMetadata: newMetadata !== undefined },
        'Updated user message with enriched content'
      );
      return true;
    } catch (error) {
      logger.error({ err: error }, 'Failed to update user message');
      return false;
    }
  }

  /**
   * Persist resolved image descriptions onto the most recent user message's
   * stored referenced-message metadata, so a quoted image survives the ~1h
   * Redis vision-cache TTL the hydrator reads from. Delegates to
   * {@link writeReferenceImageDescriptions} (extracted to keep this file under
   * the max-lines ceiling).
   *
   * @param descriptionsByUrl attachment URL → resolved description text
   * @returns number of stored reference entries that gained descriptions
   */
  async persistReferenceImageDescriptions(
    channelId: string,
    personalityId: string,
    personaId: string,
    descriptionsByUrl: Map<string, string>
  ): Promise<number> {
    return writeReferenceImageDescriptions(
      this.prisma,
      { channelId, personalityId, personaId },
      descriptionsByUrl
    );
  }

  /**
   * Get paginated conversation history with cursor support
   * Returns messages in chronological order (oldest first)
   *
   * @param channelId Channel ID
   * @param personalityId Personality ID
   * @param limit Number of messages to fetch (default: 20, max: 100)
   * @param cursor Optional cursor (message ID) to fetch messages before
   * @param contextEpoch Optional epoch timestamp - messages before this time are excluded (STM reset)
   * @returns Paginated messages and cursor for next page
   */
  async getHistory(
    channelId: string,
    personalityId: string,
    limit = 20,
    cursor?: string,
    contextEpoch?: Date
  ): Promise<{
    messages: ConversationMessage[];
    hasMore: boolean;
    nextCursor?: string;
  }> {
    try {
      // Enforce max limit to prevent excessive queries
      const safeLimit = Math.min(limit, 100);

      const messages = await this.prisma.conversationHistory.findMany({
        where: {
          channelId,
          personalityId,
          // Exclude soft-deleted messages
          deletedAt: null,
          // Filter by context epoch if provided (STM reset feature)
          ...(contextEpoch !== undefined && {
            createdAt: {
              gt: contextEpoch,
            },
          }),
        },
        orderBy: conversationRecencyOrderBy,
        take: safeLimit + 1, // Fetch one extra to check if there are more
        ...(cursor !== undefined && cursor.length > 0 ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: conversationHistorySelect,
      });

      // Check if there are more messages
      const hasMore = messages.length > safeLimit;
      const resultMessages = hasMore ? messages.slice(0, safeLimit) : messages;

      // Reverse to get chronological order (oldest first) and map to domain objects
      const history = mapToConversationMessages(resultMessages.reverse());

      // Next cursor is the ID of the last message (in desc order, before reversal)
      const nextCursor = hasMore ? resultMessages[resultMessages.length - 1].id : undefined;

      logger.debug(
        `Retrieved ${history.length} messages (hasMore: ${hasMore}, cursor: ${cursor ?? 'none'}) ` +
          `from history (channel: ${channelId}, personality: ${personalityId})`
      );

      return {
        messages: history,
        hasMore,
        nextCursor,
      };
    } catch (error) {
      logger.error({ err: error }, `Failed to get paginated conversation history`);
      return {
        messages: [],
        hasMore: false,
      };
    }
  }

  /**
   * Update the most recent assistant message with Discord message IDs (for chunked messages)
   * Used to enable deduplication of referenced messages
   */
  async updateLastAssistantMessageId(
    channelId: string,
    personalityId: string,
    personaId: string,
    discordMessageIds: string[]
  ): Promise<boolean> {
    try {
      // Find the most recent assistant message for this persona
      const lastMessage = await this.prisma.conversationHistory.findFirst({
        where: {
          channelId,
          personalityId,
          personaId,
          role: MessageRole.Assistant,
        },
        // id tiebreak so a createdAt-ms tie deterministically resolves to one
        // row — this then drives an update() on lastMessage.id below.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });

      if (!lastMessage) {
        logger.warn(
          {},
          `No assistant message found to update (channel: ${channelId}, personality: ${personalityId}, persona: ${personaId.substring(0, 8)}...)`
        );
        return false;
      }

      // Update with Discord message IDs (array for chunked messages)
      await this.prisma.conversationHistory.update({
        where: {
          id: lastMessage.id,
        },
        data: {
          discordMessageId: discordMessageIds,
        },
      });

      logger.debug(
        { messageId: lastMessage.id, discordIdCount: discordMessageIds.length },
        'Updated assistant message with Discord chunk IDs'
      );
      return true;
    } catch (error) {
      logger.error({ err: error }, 'Failed to update assistant message with Discord IDs');
      return false;
    }
  }

  /**
   * Get a message by Discord message ID
   * Used for retrieving voice transcripts from referenced messages
   */
  async getMessageByDiscordId(discordMessageId: string): Promise<ConversationMessage | null> {
    try {
      const message = await this.prisma.conversationHistory.findFirst({
        where: {
          discordMessageId: {
            has: discordMessageId,
          },
        },
        select: conversationHistorySelect,
      });

      if (!message) {
        return null;
      }

      return mapToConversationMessage(message);
    } catch (error) {
      logger.error({ err: error, discordMessageId }, `Failed to get message by Discord message ID`);
      return null;
    }
  }

  /**
   * Get recent conversation history for a channel across ALL personalities.
   * Returns messages in chronological order (oldest first).
   *
   * This method does NOT filter by personalityId — it returns all messages in the channel.
   * Use this when you need complete channel context (e.g., extended context scenarios).
   *
   * @param channelId Channel ID
   * @param limit Number of messages to fetch (default: 20)
   * @param contextEpoch Optional epoch timestamp - messages before this time are excluded
   * @param maxAgeSeconds Optional max-age cutoff in SECONDS. Mirrors the same filter
   *   in DiscordChannelFetcher so DB-resident messages don't leak past the user's
   *   "forget after X" preference (which would otherwise let stale rows fill the
   *   message budget and starve cross-channel context).
   *
   * Time-bound filters are positional rather than collapsed into a sub-options
   * object to keep the call-site shape stable; the public test surface asserts
   * positional args. If a 3rd time filter ever lands, fold them all into a
   * trailing `HistoryTimeFilter` opts object together.
   */
  async getChannelHistory(
    channelId: string,
    limit = 20,
    contextEpoch?: Date,
    maxAgeSeconds?: number | null
  ): Promise<ConversationMessage[]> {
    try {
      const cutoff = computeHistoryCutoff(maxAgeSeconds, contextEpoch);
      const messages = await this.prisma.conversationHistory.findMany({
        where: {
          channelId,
          // NO personalityId filter - fetch ALL channel messages
          deletedAt: null,
          ...(cutoff !== undefined ? { createdAt: { gte: cutoff } } : {}),
        },
        orderBy: conversationRecencyOrderBy,
        take: limit,
        select: conversationHistorySelect,
      });

      // Reverse to get chronological order (oldest first) and map to domain objects
      const history = mapToConversationMessages(messages.reverse());

      logger.debug(
        { count: history.length, channelId },
        'Retrieved channel history across all personalities'
      );
      return history;
    } catch (error) {
      logger.error({ err: error }, 'Failed to get channel conversation history');
      return [];
    }
  }

  /**
   * Get a user's conversation history with a personality from OTHER channels.
   * Returns messages grouped by channel, ordered by most recent activity.
   * Messages within each group are in chronological order (oldest first).
   *
   * Used to surface cross-channel context with a personality when
   * crossChannelHistoryEnabled is true. Results are NOT scoped to a guild —
   * messages from any channel (including DMs) the same persona has used
   * with this personality are eligible.
   *
   * @param personaId User's persona ID
   * @param personalityId AI personality ID
   * @param excludeChannelId Channel to exclude (the current channel)
   * @param limit Maximum total messages to fetch across all channels (capped at 100).
   *   The limit applies globally, not per-channel. If the N most recent messages
   *   all come from one channel, older channels will be entirely absent from results.
   * @param timeFilter Optional max-age + contextEpoch cutoffs. Mirrors the
   *   current-channel filter in DiscordChannelFetcher so a user's "forget after X"
   *   preference applies uniformly across both context sources. The two cutoffs
   *   are combined via max(); the more recent timestamp wins.
   */
  async getCrossChannelHistory(
    personaId: string,
    personalityId: string,
    excludeChannelId: string,
    limit = 50,
    timeFilter: HistoryTimeFilter = {}
  ): Promise<CrossChannelHistoryGroup[]> {
    try {
      const safeLimit = Math.min(limit, 100);
      const cutoff = computeHistoryCutoff(timeFilter.maxAgeSeconds, timeFilter.contextEpoch);

      const messages = await this.prisma.conversationHistory.findMany({
        where: {
          personaId,
          personalityId,
          channelId: { not: excludeChannelId },
          deletedAt: null,
          ...(cutoff !== undefined ? { createdAt: { gte: cutoff } } : {}),
        },
        orderBy: conversationRecencyOrderBy,
        take: safeLimit,
        select: conversationHistorySelect,
      });

      if (messages.length === 0) {
        return [];
      }

      // Group by channelId using Map (preserves insertion order = most recent channel first)
      const channelGroups = new Map<string, typeof messages>();
      for (const message of messages) {
        const group = channelGroups.get(message.channelId);
        if (group !== undefined) {
          group.push(message);
        } else {
          channelGroups.set(message.channelId, [message]);
        }
      }

      // Convert each group to chronological order (oldest first), then sort
      // groups ASC by their newest message — so the channel closest in time to
      // the current turn appears last, immediately before current_conversation.
      // `channelMessages[0]` is the newest because the query is `createdAt DESC`.
      const sortedGroups = Array.from(channelGroups, ([channelId, channelMessages]) => ({
        group: {
          channelId,
          guildId: channelMessages[0].guildId,
          messages: mapToConversationMessages(channelMessages.toReversed()),
        } satisfies CrossChannelHistoryGroup,
        newestAt: channelMessages[0].createdAt,
      }))
        .sort((a, b) => a.newestAt.getTime() - b.newestAt.getTime())
        .map(t => t.group);

      logger.debug(
        {
          messageCount: messages.length,
          groupCount: sortedGroups.length,
          personaId,
          personalityId,
          excludeChannelId,
        },
        'Retrieved cross-channel messages'
      );

      return sortedGroups;
    } catch (error) {
      logger.error({ err: error }, 'Failed to get cross-channel conversation history');
      return [];
    }
  }

  /**
   * Get conversation history statistics for a channel + personality
   * Used for /history stats command
   *
   * @param channelId Channel ID
   * @param personalityId Personality ID
   * @param contextEpoch Optional epoch timestamp - messages before this time are excluded
   * @returns Statistics about the conversation history
   */
  async getHistoryStats(
    channelId: string,
    personalityId: string,
    contextEpoch?: Date
  ): Promise<{
    totalMessages: number;
    userMessages: number;
    assistantMessages: number;
    oldestMessage?: Date;
    newestMessage?: Date;
  }> {
    try {
      const whereClause = {
        channelId,
        personalityId,
        ...(contextEpoch !== undefined && {
          createdAt: {
            gt: contextEpoch,
          },
        }),
      };

      // Get counts by role
      const [total, userCount, assistantCount, oldest, newest] = await Promise.all([
        this.prisma.conversationHistory.count({ where: whereClause }),
        this.prisma.conversationHistory.count({
          where: { ...whereClause, role: MessageRole.User },
        }),
        this.prisma.conversationHistory.count({
          where: { ...whereClause, role: MessageRole.Assistant },
        }),
        this.prisma.conversationHistory.findFirst({
          where: whereClause,
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        }),
        this.prisma.conversationHistory.findFirst({
          where: whereClause,
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
      ]);

      return {
        totalMessages: total,
        userMessages: userCount,
        assistantMessages: assistantCount,
        oldestMessage: oldest?.createdAt,
        newestMessage: newest?.createdAt,
      };
    } catch (error) {
      logger.error({ err: error }, `Failed to get conversation history stats`);
      return {
        totalMessages: 0,
        userMessages: 0,
        assistantMessages: 0,
      };
    }
  }
}
