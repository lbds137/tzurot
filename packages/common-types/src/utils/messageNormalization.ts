/**
 * Message Normalization Utilities
 *
 * Centralized utilities for normalizing message data across service boundaries.
 * Handles legacy data formats and ensures consistent types for the AI pipeline.
 *
 * @module messageNormalization
 *
 * Background: Extended context feature introduced data transformation across 5+ layers.
 * This caused type mismatches (Date vs string for createdAt) and role inconsistencies
 * (legacy "User"/"Assistant" vs current "user"/"assistant"). These utilities provide
 * a single source of truth for normalization, applied at service boundaries.
 */

import { MessageRole } from '../constants/message.js';

/**
 * Normalize a role string to the standard MessageRole enum value.
 *
 * Handles legacy data that may have capitalized roles ("User", "Assistant")
 * from older database records or external sources.
 *
 * @param role - The role string to normalize (case-insensitive)
 * @returns The normalized MessageRole value
 * @throws Error if the role is not a valid message role
 *
 * @example
 * normalizeRole('User')      // Returns MessageRole.User ('user')
 * normalizeRole('ASSISTANT') // Returns MessageRole.Assistant ('assistant')
 * normalizeRole('system')    // Returns MessageRole.System ('system')
 */
export function normalizeRole(role: string): MessageRole {
  const normalized = role.toLowerCase();

  switch (normalized) {
    case 'user':
      return MessageRole.User;
    case 'assistant':
      return MessageRole.Assistant;
    case 'system':
      return MessageRole.System;
    default:
      throw new Error(`Invalid message role: "${role}". Expected user, assistant, or system.`);
  }
}

/**
 * Check if a role matches the expected role (case-insensitive comparison).
 *
 * Use this instead of direct equality checks to handle legacy capitalized roles.
 *
 * @param actual - The actual role value from data
 * @param expected - The expected role (from MessageRole enum)
 * @returns true if the roles match (case-insensitive)
 *
 * @example
 * isRoleMatch('User', MessageRole.User)           // true
 * isRoleMatch('ASSISTANT', MessageRole.Assistant) // true
 * isRoleMatch('user', MessageRole.Assistant)      // false
 */
export function isRoleMatch(actual: string | MessageRole, expected: MessageRole): boolean {
  const normalizedActual = String(actual).toLowerCase();
  const normalizedExpected = String(expected).toLowerCase();
  return normalizedActual === normalizedExpected;
}

/**
 * Normalize a timestamp to ISO 8601 string format.
 *
 * Handles various input types that may occur across service boundaries:
 * - Date objects (from Discord.js or DB queries before JSON serialization)
 * - ISO strings (after BullMQ/JSON serialization)
 * - undefined/null (optional timestamps)
 *
 * @param timestamp - The timestamp to normalize
 * @returns ISO 8601 string, or undefined if input is null/undefined/invalid
 *
 * @example
 * normalizeTimestamp(new Date('2024-01-15'))  // '2024-01-15T00:00:00.000Z'
 * normalizeTimestamp('2024-01-15T00:00:00Z')  // '2024-01-15T00:00:00Z'
 * normalizeTimestamp(undefined)              // undefined
 */
export function normalizeTimestamp(
  timestamp: Date | string | undefined | null
): string | undefined {
  if (timestamp === undefined || timestamp === null) {
    return undefined;
  }

  // Handle Date objects directly (defensive - should be strings after BullMQ serialization)
  if (timestamp instanceof Date) {
    const time = timestamp.getTime();
    return Number.isNaN(time) ? undefined : timestamp.toISOString();
  }

  // Handle string timestamps (expected case - ISO format from toISOString())
  if (typeof timestamp === 'string' && timestamp.length > 0) {
    // Validate it's a parseable date
    const time = new Date(timestamp).getTime();
    return Number.isNaN(time) ? undefined : timestamp;
  }

  return undefined;
}

/**
 * Extract Unix timestamp in milliseconds from various formats.
 *
 * Similar to normalizeTimestamp but returns a number for calculations
 * (e.g., finding oldest timestamp for LTM deduplication).
 *
 * @param timestamp - The timestamp to extract
 * @returns Unix timestamp in milliseconds, or null if invalid/missing
 *
 * @example
 * extractTimestampMs(new Date('2024-01-15'))  // 1705276800000
 * extractTimestampMs('2024-01-15T00:00:00Z')  // 1705276800000
 * extractTimestampMs(undefined)              // null
 */
export function extractTimestampMs(timestamp: Date | string | undefined | null): number | null {
  if (timestamp === undefined || timestamp === null) {
    return null;
  }

  // Handle Date objects directly
  if (timestamp instanceof Date) {
    const time = timestamp.getTime();
    return Number.isNaN(time) ? null : time;
  }

  // Handle string timestamps
  if (typeof timestamp === 'string' && timestamp.length > 0) {
    const time = new Date(timestamp).getTime();
    return Number.isNaN(time) ? null : time;
  }

  return null;
}

/**
 * Conversation message with optional loose types for normalization input.
 * Accepts the variations that may come from different sources.
 */
export interface LooseConversationMessage {
  id?: string;
  role: string; // May be capitalized: "User", "Assistant"
  content: string;
  tokenCount?: number;
  createdAt?: Date | string; // May be Date or string
  personaId?: string;
  personaName?: string;
  discordUsername?: string;
  messageMetadata?: Record<string, unknown>;
}

/**
 * Normalized conversation message with strict types.
 * Safe to use throughout the AI pipeline.
 */
export interface NormalizedConversationMessage {
  id?: string;
  role: MessageRole;
  content: string;
  tokenCount?: number;
  createdAt?: string; // Always ISO string
  personaId?: string;
  personaName?: string;
  discordUsername?: string;
  messageMetadata?: Record<string, unknown>;
}

/**
 * Normalize a conversation message for the AI pipeline.
 *
 * Ensures consistent types regardless of input source (DB, Discord fetch, legacy data).
 * Call this at service boundaries (e.g., when processing BullMQ job data).
 *
 * @param msg - The message to normalize (may have loose types)
 * @returns Normalized message with strict types
 * @throws Error if role is invalid
 *
 * @example
 * normalizeConversationMessage({
 *   role: 'User',
 *   content: 'Hello',
 *   createdAt: new Date()
 * })
 * // Returns { role: 'user', content: 'Hello', createdAt: '2024-01-15T...' }
 */
export function normalizeConversationMessage(
  msg: LooseConversationMessage
): NormalizedConversationMessage {
  return {
    id: msg.id,
    role: normalizeRole(msg.role),
    content: msg.content,
    tokenCount: msg.tokenCount,
    createdAt: normalizeTimestamp(msg.createdAt),
    personaId: msg.personaId,
    personaName: msg.personaName,
    discordUsername: msg.discordUsername,
    messageMetadata: msg.messageMetadata,
  };
}

/**
 * Normalize an array of conversation messages.
 *
 * Convenience wrapper for normalizing entire conversation history.
 * Invalid roles will cause an error to be thrown (fail fast).
 *
 * @param messages - Array of messages to normalize
 * @returns Array of normalized messages
 */
export function normalizeConversationHistory(
  messages: LooseConversationMessage[]
): NormalizedConversationMessage[] {
  return messages.map(normalizeConversationMessage);
}
