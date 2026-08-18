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
import {
  type ConversationMessage,
  type CrossChannelHistoryGroup,
} from '@tzurot/common-types/types/conversationMessage';
import { type MessageMetadata } from '@tzurot/common-types/types/schemas/message';
import { generateConversationHistoryUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { countTextTokens } from '@tzurot/common-types/utils/tokenCounter';
import { findTriggerMessage } from './triggerReferenceWriter.js';
import {
  buildChannelHistoryWhere,
  conversationHistorySelect,
  conversationRecencyOrderBy,
  mapToConversationMessage,
  mapToConversationMessages,
  type ConversationHistoryClient,
  type ConversationHistoryQueryResult,
  type TransactionalConversationHistoryClient,
} from './ConversationMessageMapper.js';
import {
  resolveEvictionChunk,
  resolveHistoryWindow,
  type HistoryWindowMeta,
} from './historyWindow.js';

const logger = createLogger('ConversationHistoryService');

/**
 * Optional time-bound filters for history fetches. Kept as a sub-options
 * object so adding a new filter (e.g., per-personality scope) doesn't push
 * `getCrossChannelHistory` past the max-params limit.
 */
export interface HistoryTimeFilter {
  /** Max-age cutoff in SECONDS (matches DiscordChannelFetcher's unit). */
  maxAgeSeconds?: number | null;
  /** Explicit reset point — e.g., from `/conversation reset`. */
  contextEpoch?: Date;
}

/** Inputs to the windowed channel-history fetch. */
export interface ChannelHistoryWindowParams {
  channelId: string;
  /**
   * The message cap for this request — the window's UPPER bound, not its size.
   *
   * Three regimes, by `chunk = min(ceil(0.25 * cap), cap - FLOOR)`:
   *
   * - **cap ≤ 20 — chunk 0, off.** No band: the window tracks the row count
   *   exactly, up to the cap. This is the pre-hysteresis behavior, and it is
   *   reachable — `maxMessages` accepts 1.
   * - **cap = 21 — chunk 1, on but inert.** Nominally quantized, and worth
   *   nothing: evicting one row at a time IS sliding by one, the exact disease
   *   this mechanism exists to cure. Do not read `chunk > 0` as "benefit".
   * - **cap ≥ 22 — chunk ≥ 2, effective.** The window sits in
   *   `(cap - chunk, cap]` and its start holds still for a whole chunk. The
   *   lower bound lands NEAR 0.75 * cap but not exactly — the `ceil`, and the
   *   floor clamp near small caps.
   *
   * The default cap is 50 (chunk 13), comfortably clear of the inert band.
   * `resolveEvictionChunk` is the authority for which regime a cap is in.
   */
  cap: number;
  /** Explicit reset point — messages before it are excluded. */
  contextEpoch?: Date;
  /**
   * Max-age cutoff in SECONDS. Mirrors the same filter in
   * DiscordChannelFetcher so DB-resident messages don't leak past the user's
   * "forget after X" preference (which would otherwise let stale rows fill the
   * message budget and starve cross-channel context).
   */
  maxAgeSeconds?: number | null;
  /**
   * The triggering Discord message id, excluded from the window. The caller
   * delivers that turn as the live user message, so including it here renders
   * it twice.
   */
  excludeDiscordMessageId?: string;
}

/** A windowed channel-history read: the messages plus how they were chosen. */
export interface ChannelHistoryWindowResult {
  /** Chronological order, oldest first. */
  messages: ConversationMessage[];
  meta: HistoryWindowMeta;
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
  /**
   * The model's reasoning trace for an assistant turn. Written once here at
   * row creation and never updated — the column is LWW-neutral by that
   * construction (03-database.md § Sync-Tracked Tables).
   */
  thinkingContent?: string;
}

export class ConversationHistoryService {
  constructor(private prisma: ConversationHistoryClient) {}

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
      thinkingContent,
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
          // Empty normalizes to null so "no trace" has ONE representation in
          // the column. Readers already treat null and '' alike, but that is a
          // convention every reader has to keep; storing null makes it
          // structural, and keeps the DB agreeing with the `hasTrace`-style
          // `!== null` checks rather than silently disagreeing.
          ...(thinkingContent !== undefined && {
            thinkingContent: thinkingContent === '' ? null : thinkingContent,
          }),
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
          thinkingLength: thinkingContent?.length ?? 0,
        },
        'Added message to history'
      );
    } catch (error) {
      logger.error({ err: error }, 'Failed to add message to conversation history');
      throw error;
    }
  }

  /**
   * Update the trigger user message's content for a persona in a channel.
   * Used to enrich user messages with attachment descriptions after AI
   * processing.
   *
   * Content and token count ONLY. This deliberately does not touch
   * `message_metadata`: that column has concurrent writers keying on
   * different fields of one JSON blob, and every write to it goes through a
   * server-side merge (see `messageMetadataMerge.ts`) precisely so none can
   * overwrite another's key. A Prisma update from here would be exactly the
   * read-modify-write those writers exist to avoid, so the capability is
   * absent rather than available-and-discouraged.
   *
   * @param newContent Updated plain text content (user message + attachment
   *   descriptions). The token count is recomputed from it rather than passed
   *   in, so the two cannot disagree.
   * @param options `triggerMessageId` targets the exact row the job was queued
   *   for (see {@link findTriggerMessage}).
   */
  async updateLastUserMessage(
    channelId: string,
    personalityId: string,
    personaId: string,
    newContent: string,
    options?: { triggerMessageId?: string }
  ): Promise<boolean> {
    try {
      const target = await findTriggerMessage(
        this.prisma,
        { channelId, personalityId, personaId },
        options?.triggerMessageId
      );

      if (target === null) {
        logger.warn(
          {},
          `No user message found to update (channel: ${channelId}, personality: ${personalityId}, persona: ${personaId.substring(0, 8)}...)`
        );
        return false;
      }

      const tokenCount = countTextTokens(newContent);

      await this.prisma.conversationHistory.update({
        where: { id: target.id },
        data: { content: newContent, tokenCount },
      });

      logger.debug(
        { messageId: target.id, tokenCount, targeting: target.targeting },
        'Updated user message with enriched content'
      );
      return true;
    } catch (error) {
      logger.error({ err: error }, 'Failed to update user message');
      return false;
    }
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

/** The window read itself, over whichever client the caller decided on. */
async function readWindowIn(
  client: ConversationHistoryClient,
  where: ReturnType<typeof buildChannelHistoryWhere>,
  cap: number
): Promise<{
  rows: ConversationHistoryQueryResult[];
  window: ReturnType<typeof resolveHistoryWindow>;
  inScopeCount: number;
}> {
  const counted = await client.conversationHistory.count({ where });
  const resolved = resolveHistoryWindow(counted, cap);
  if (resolved.take === 0) {
    return { rows: [], window: resolved, inScopeCount: counted };
  }
  const fetched = await client.conversationHistory.findMany({
    where,
    orderBy: conversationRecencyOrderBy,
    take: resolved.take,
    select: conversationHistorySelect,
  });
  return { rows: fetched, window: resolved, inScopeCount: counted };
}

/**
 * The chunk-0 read: no eviction to compute, so no snapshot needed.
 *
 * **`take` is the CAP, never a count-derived number.** That is precisely what
 * makes the missing transaction harmless — Postgres self-limits to however many
 * rows exist, so a concurrent insert between the two queries cannot change what
 * this returns. An earlier revision passed the count-derived `min(n, cap)` here
 * and reasoned about it as though it were `cap`: with 8 rows counted, a cap of
 * 10, and 3 rows inserted in between, the fetch asked for 8 and the turn
 * silently got less history than it was configured for — a race the pre-window
 * single-query code never had. Pinned by 'fetches the CAP, not the counted
 * value' in the unit tests.
 *
 * The count runs after the fetch and only feeds telemetry — so its failure must
 * not discard rows already in hand. Without the guard below, adding this second,
 * non-essential round trip would have made a transient count error empty the
 * turn's entire `<chat_log>`, which the pre-window single-query path had no way
 * to do. A telemetry miss degrades `inScopeCount`, never the history.
 *
 * `inScopeCount` is clamped up to the rows returned because a row can stop
 * matching the predicate between the two reads — a soft-delete (`deletedAt`)
 * on a row already fetched — which would report an `inScopeCount` below `take`
 * and break the conservation invariant in the meta. (An INSERT cannot cause
 * this: a new matching row only raises the count.)
 */
async function readWindowByCapOnly(
  client: ConversationHistoryClient,
  where: ReturnType<typeof buildChannelHistoryWhere>,
  cap: number
): ReturnType<typeof readWindowIn> {
  const effectiveCap = Math.max(0, cap);
  const fetched =
    effectiveCap === 0
      ? []
      : await client.conversationHistory.findMany({
          where,
          orderBy: conversationRecencyOrderBy,
          take: effectiveCap,
          select: conversationHistorySelect,
        });
  let counted: number;
  try {
    counted = await client.conversationHistory.count({ where });
  } catch (error) {
    // The rows are already fetched and correct; the count is diagnostic. Losing
    // it costs a telemetry field, so it must not propagate to the caller's
    // catch, which degrades the whole turn to empty history.
    logger.warn({ err: error }, 'History-window count failed; telemetry only, rows unaffected');
    counted = fetched.length;
  }
  return {
    rows: fetched,
    window: { evicted: 0, take: fetched.length, chunk: 0 },
    inScopeCount: Math.max(counted, fetched.length),
  };
}

/**
 * Get recent conversation history for a channel across ALL personalities, as a
 * hysteresis-quantized window. Returns messages in chronological order (oldest
 * first) plus the window telemetry that produced them.
 *
 * Does NOT filter by personalityId — it returns all messages in the channel.
 * Use this when you need complete channel context (e.g. extended context).
 *
 * **The count and the fetch run in ONE repeatable-read transaction.** Both
 * halves of the window arithmetic read the same predicate, so a write landing
 * between them would make the resolved eviction describe a row set that no
 * longer exists — the head would slide by one for that request, which is
 * precisely the per-turn cache miss the quantization removes. The snapshot is
 * load-bearing, not defensive.
 *
 * A free function on {@link TransactionalConversationHistoryClient} rather than
 * a `ConversationHistoryService` method, because the service is also
 * constructed over api-gateway's fast pool (`deps.fastPrisma ?? deps.prisma` in
 * the conversation-persist routes), which carries a blanket retry-once that is
 * safe only for idempotent single-row work. Putting a transaction behind a
 * method there would have required widening the service's client type, which is
 * the very thing that keeps `$transaction` off that pool at compile time. The
 * capability is demanded here, at the one signature that needs it.
 *
 * Still the single home for the window: same module, same shared predicate
 * builder, one snapshot — which is what the design's O3 call was protecting.
 */
export async function getChannelHistoryWindow(
  prisma: TransactionalConversationHistoryClient,
  params: ChannelHistoryWindowParams
): Promise<ChannelHistoryWindowResult> {
  const { channelId, cap, contextEpoch, maxAgeSeconds, excludeDiscordMessageId } = params;
  const cutoff = computeHistoryCutoff(maxAgeSeconds, contextEpoch);
  const where = buildChannelHistoryWhere({ channelId, cutoff, excludeDiscordMessageId });

  try {
    // The snapshot exists so the count and the fetch describe the SAME row set —
    // the quantized eviction is computed from one and applied to the other.
    // `resolveEvictionChunk` is a pure function of `cap` alone, so which regime
    // a request is in is decidable before opening anything.
    //
    // With chunk 0 there is no eviction to compute, so the fetch asks for the
    // CAP and lets Postgres return however many rows exist — nothing it does
    // depends on the count, and the transaction has no job. A sub-21 cap
    // therefore stops holding one pooled connection across two sequential
    // queries. It still counts, for telemetry only: `inScopeCount` is the sole
    // signal for how much history the cap dropped.
    const { rows, window, inScopeCount } =
      resolveEvictionChunk(Math.max(0, cap)) === 0
        ? await readWindowByCapOnly(prisma, where, cap)
        : await prisma.$transaction(async tx => readWindowIn(tx, where, cap), {
            isolationLevel: 'RepeatableRead',
          });

    // Reverse to get chronological order (oldest first) and map to domain objects
    const messages = mapToConversationMessages(rows.reverse());
    const meta: HistoryWindowMeta = {
      // The counted value, carried out of the transaction — NOT reconstructed
      // as `evicted + take`. Those agree only while hysteresis is active: with
      // chunk 0 (any cap below 21, and `maxMessages` accepts 1) nothing is
      // evicted and `take` saturates at the cap, so the reconstruction would
      // report the cap as the row count for every over-cap channel.
      inScopeCount,
      evicted: window.evicted,
      take: window.take,
      chunk: window.chunk,
      headRowId: messages[0]?.id ?? null,
      degraded: false,
    };

    // info, not debug: this IS the acceptance instrument for the whole
    // hysteresis design — `headRowId` holding still across a chunk is the
    // claim, and prod runs at LOG_LEVEL=info by default, so a debug line
    // would make the design unverifiable without a manual level bump nobody
    // would know to make. The sibling cache telemetry (`logGeneratedResponse`)
    // is already info for the same reason; these two get read together.
    // One low-cardinality line per AI turn.
    logger.info({ ...meta, channelId }, 'Retrieved channel history window');
    return { messages, meta };
  } catch (error) {
    // channelId is on this line deliberately: a degraded read is exactly when
    // you need to know WHICH channel, and the success path already carries it.
    logger.error({ err: error, channelId }, 'Failed to get channel conversation history');
    // Parity with the pre-window behavior: a read failure degrades to empty
    // history rather than failing the turn. `degraded` distinguishes it from
    // a genuinely empty channel, which look identical in the meta otherwise.
    return {
      messages: [],
      meta: { inScopeCount: 0, evicted: 0, take: 0, chunk: 0, headRowId: null, degraded: true },
    };
  }
}
