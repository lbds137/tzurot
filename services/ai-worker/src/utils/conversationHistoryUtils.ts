/**
 * Conversation History Utilities
 *
 * Pure data extraction utilities for working with conversation history.
 * These are reusable helpers for extracting specific messages from history,
 * independent of the duplicate detection algorithm.
 */

import { createLogger } from '@tzurot/common-types';

const logger = createLogger('ConversationHistoryUtils');

/**
 * Number of recent assistant messages to extract by default.
 * Set to 5 based on production observations showing API-level caching
 * can return responses from 3-4 turns back.
 */
const DEFAULT_MAX_ASSISTANT_MESSAGES = 5;

/**
 * Get the last assistant message from raw conversation history.
 *
 * @param history Raw conversation history entries
 * @returns The last assistant message content, or undefined if none found
 */
export function getLastAssistantMessage(
  history: { role: string; content: string }[] | undefined
): string | undefined {
  if (!history || history.length === 0) {
    return undefined;
  }

  // Find the last assistant message (iterate from end)
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'assistant') {
      return history[i].content;
    }
  }

  return undefined;
}

/**
 * Get recent assistant messages from raw conversation history.
 *
 * Returns up to maxMessages assistant messages to check for cross-turn duplicates.
 * This catches cases where API-level caching returns an older cached response,
 * not just the immediate previous one.
 *
 * @param history Raw conversation history entries
 * @param maxMessages Maximum number of messages to return (default 5)
 * @returns Array of recent assistant message contents (most recent first)
 */
export function getRecentAssistantMessages(
  history: { role: string; content: string }[] | undefined,
  maxMessages = DEFAULT_MAX_ASSISTANT_MESSAGES
): string[] {
  if (!history || history.length === 0) {
    logger.debug('[ConversationHistoryUtils] No history provided for assistant message extraction');
    return [];
  }

  const messages: string[] = [];

  // Find assistant messages from end (most recent first)
  for (let i = history.length - 1; i >= 0 && messages.length < maxMessages; i--) {
    if (history[i].role === 'assistant') {
      messages.push(history[i].content);
    }
  }

  // Compute role distribution for diagnostics
  const roleDistribution = history.reduce(
    (acc, msg) => {
      acc[msg.role] = (acc[msg.role] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  // DIAGNOSTIC: Log at INFO level when we have history but find no assistant messages
  // This is the anomaly that can cause duplicate detection to fail
  if (messages.length === 0 && history.length > 0) {
    const sampleRoles = history.slice(-5).map(msg => ({
      role: msg.role,
      roleType: typeof msg.role,
      contentLength: msg.content.length,
    }));

    logger.info(
      {
        historyLength: history.length,
        roleDistribution,
        sampleRoles,
        expectedRole: 'assistant',
      },
      '[ConversationHistoryUtils] ANOMALY: No assistant messages found in non-empty history. ' +
        'This may cause duplicate responses to go undetected.'
    );
  } else {
    logger.debug(
      {
        historyLength: history.length,
        assistantMessagesFound: messages.length,
        roleDistribution,
        maxMessages,
      },
      '[ConversationHistoryUtils] Extracted recent assistant messages from history'
    );
  }

  return messages;
}
