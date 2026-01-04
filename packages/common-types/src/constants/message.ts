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
   * Maximum number of referenced messages to include in AI context
   * Referenced messages come from replies, message links, and embeds
   */
  MAX_REFERENCED_MESSAGES: 20,
  /**
   * Maximum conversation history messages to fetch from database
   * AI worker will further trim based on token budget
   */
  MAX_HISTORY_FETCH: 100,
  /**
   * Maximum messages to fetch from Discord for extended context
   * These are merged with DB history for broader channel awareness
   */
  MAX_EXTENDED_CONTEXT: 100,
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
} as const;
