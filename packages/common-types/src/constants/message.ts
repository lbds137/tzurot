/**
 * Message Constants
 *
 * Message roles and placeholder patterns for conversations.
 */

/**
 * Message role types for conversation history
 */
export enum MessageRole {
  User = 'user',
  Assistant = 'assistant',
  System = 'system',
}

/**
 * Placeholder patterns for user and assistant names in prompts/memories
 * These are replaced with actual names at runtime
 */
export const PLACEHOLDERS = {
  /** User placeholders - all variations get replaced with the user's name */
  USER: ['{user}', '{{user}}'] as const,
  /** Assistant placeholders - all variations get replaced with the assistant/personality name */
  ASSISTANT: ['{assistant}', '{shape}', '{{char}}', '{personality}'] as const,
} as const;

/**
 * Message context limits
 * These control how much context is included in AI requests
 */
export const MESSAGE_LIMITS = {
  /**
   * Default value for maxMessages in LlmConfig
   * Controls how many messages to include in context for personality
   */
  DEFAULT_MAX_MESSAGES: 50,
  /**
   * Default value for maxImages in LlmConfig
   * Controls how many images to process in extended context
   */
  DEFAULT_MAX_IMAGES: 10,
  /**
   * Maximum messages to fetch from Discord for extended context
   * These are merged with DB history for broader channel awareness
   * Also used as validation cap for maxMessages in LlmConfig
   */
  MAX_EXTENDED_CONTEXT: 100,
  /**
   * Maximum images allowed in extended context
   * Validation cap for maxImages in LlmConfig (0 = disabled)
   */
  MAX_CONTEXT_IMAGES: 20,
  /**
   * Maximum age for context messages in seconds (30 days)
   * Validation cap for maxAge in LlmConfig (null = no limit)
   * Prevents fetching years of history in busy channels
   */
  MAX_CONTEXT_AGE: 2592000, // 30 * 24 * 60 * 60
  /**
   * Maximum number of Discord server roles to include per participant
   * Sorted by position (highest priority first), excluding @everyone
   * Balances context richness vs token usage
   */
  MAX_GUILD_ROLES: 5,
  /**
   * Maximum number of unique participants to include guild info for
   * Keeps the most recently active participants (closest to triggering message)
   * Prevents unbounded growth in busy public channels
   */
  MAX_EXTENDED_CONTEXT_PARTICIPANTS: 20,
  /**
   * Maximum number of recent messages to extract reactions from
   * Reactions provide social context without timestamps (Discord API limitation)
   */
  MAX_REACTION_MESSAGES: 5,
  /**
   * Maximum number of reaction types to extract per message
   * Limits API calls to Discord when fetching reactor users
   */
  MAX_REACTIONS_PER_MESSAGE: 3,
  /**
   * Maximum number of reactor users to include per reaction
   * Prevents context bloat on popular messages with many reactors
   */
  MAX_USERS_PER_REACTION: 5,
  /**
   * Maximum number of participant personas to include in AI prompt context
   * These get full persona details (name, pronouns, about text)
   */
  MAX_PARTICIPANT_PERSONAS: 10,
} as const;

/**
 * Multi-tag fan-out limits.
 *
 * When a single message tags multiple personalities (reply-to-character +
 * inline @-mentions + activated channel or DM-session personality), the
 * bot fans out responses in parallel and delivers them in slot order once
 * all have completed.
 */
export const MULTI_TAG = {
  /**
   * Maximum number of characters that can respond to a single message.
   * Slot 0 = reply-to-character; slot 1 = activated/DM-session; remaining
   * slots = inline mentions in textual order. Dedupe by personality ID
   * before applying the cap.
   */
  MAX_TAGS: 5,
  /**
   * Safety-net timeout for the multi-tag coordinator. On fire, the
   * coordinator flushes the slots that did complete and synthesizes
   * timeout content for the rest.
   *
   * Sized at 18 min: vision-heavy jobs (many extended-context images +
   * a slow model) legitimately run 10–15 min, and the worker lock
   * (TIMEOUTS.WORKER_LOCK_DURATION) is 20 min — so this sits below the
   * worker ceiling with headroom while no longer firing on jobs that are
   * still genuinely processing. A late result that lands after this fires
   * is recovered (not dropped) by the synthetic-timeout recovery path in
   * MessageHandler. Keep this >= ORDERING_MAX_WAIT_MS so the per-channel
   * ordering buffer never force-processes a group before this backstop.
   */
  COORDINATOR_TIMEOUT_MS: 18 * 60 * 1000,
  /**
   * Max time the per-channel ResponseOrderingService buffers a pending
   * group before force-processing it. Decoupled from TIMEOUTS.JOB_WAIT
   * (which is shared with the STT-transcription gateway wait and must stay
   * short) so the chat ordering buffer can wait as long as the coordinator.
   * Held equal to COORDINATOR_TIMEOUT_MS: the coordinator is the authoritative
   * give-up point; the ordering buffer must not fire first.
   */
  ORDERING_MAX_WAIT_MS: 18 * 60 * 1000,
  /**
   * TTL for persisted coordinator entries in Redis. Longer than
   * COORDINATOR_TIMEOUT_MS so restart-recovery has a window even if a
   * timeout was about to fire pre-restart. Also bounds the
   * synthetic-timeout recovery marker's lifetime.
   */
  REDIS_TTL_SEC: 30 * 60,
} as const;

/**
 * Sentinel stored as message content when a message has no usable text
 * (e.g. attachment-only messages, or a forward whose snapshot extraction
 * yielded nothing). Persistence writes this; recovery treats it as empty so
 * a poisoned row can be re-healed from live extended context. Both sides MUST
 * reference this constant — a literal drift between writer and reader is what
 * let placeholder-valued rows silently dodge recovery.
 */
export const NO_TEXT_CONTENT_PLACEHOLDER = '[no text content]';

/**
 * Unknown User Constants
 * Used for forwarded messages where author information is unavailable
 * These must be used consistently to allow filtering during batch user creation
 */

/** Placeholder Discord user ID for messages with unknown authors (forwarded messages) */
export const UNKNOWN_USER_DISCORD_ID = 'unknown';

/** Placeholder display name for messages with unknown authors (forwarded messages) */
export const UNKNOWN_USER_NAME = 'Unknown User';
