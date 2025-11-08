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
