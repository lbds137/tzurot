/**
 * Conversation Manager
 *
 * Tracks conversation history per channel for context-aware responses.
 * Keeps the last N messages per channel/personality, with no time-based expiration.
 */

import { createLogger, MessageRole } from '@tzurot/common-types';

const logger = createLogger('ConversationManager');

interface ConversationMessage {
  role: MessageRole;
  content: string;
  timestamp: number;
}

interface ConversationThread {
  messages: ConversationMessage[];
}

export class ConversationManager {
  private conversations = new Map<string, ConversationThread>();
  private readonly maxMessagesPerThread: number;

  constructor(
    options: {
      maxMessagesPerThread?: number;
    } = {}
  ) {
    this.maxMessagesPerThread = options.maxMessagesPerThread ?? 20; // Keep last 20 messages
  }

  /**
   * Get conversation key for a channel + personality
   */
  private getKey(channelId: string, personalityName: string): string {
    return `${channelId}:${personalityName}`;
  }

  /**
   * Add a user message to the conversation
   */
  addUserMessage(channelId: string, personalityName: string, content: string): void {
    const key = this.getKey(channelId, personalityName);
    const thread = this.getOrCreateThread(key);

    thread.messages.push({
      role: MessageRole.User,
      content,
      timestamp: Date.now(),
    });

    // Trim to max length (keep most recent)
    if (thread.messages.length > this.maxMessagesPerThread) {
      thread.messages = thread.messages.slice(-this.maxMessagesPerThread);
    }

    logger.debug(
      `[ConversationManager] Added user message to ${key} (${thread.messages.length} total)`
    );
  }

  /**
   * Add an assistant response to the conversation
   */
  addAssistantMessage(channelId: string, personalityName: string, content: string): void {
    const key = this.getKey(channelId, personalityName);
    const thread = this.getOrCreateThread(key);

    thread.messages.push({
      role: MessageRole.Assistant,
      content,
      timestamp: Date.now(),
    });

    // Trim to max length
    if (thread.messages.length > this.maxMessagesPerThread) {
      thread.messages = thread.messages.slice(-this.maxMessagesPerThread);
    }

    logger.debug(
      `[ConversationManager] Added assistant message to ${key} (${thread.messages.length} total)`
    );
  }

  /**
   * Get conversation history for a channel + personality
   */
  getHistory(channelId: string, personalityName: string): { role: MessageRole; content: string }[] {
    const key = this.getKey(channelId, personalityName);
    const thread = this.conversations.get(key);

    if (thread === undefined) {
      return [];
    }

    // Return without timestamps (API doesn't need them)
    return thread.messages.map(({ role, content }) => ({ role, content }));
  }

  /**
   * Clear conversation for a specific channel + personality
   */
  clearConversation(channelId: string, personalityName: string): void {
    const key = this.getKey(channelId, personalityName);
    this.conversations.delete(key);
    logger.info(`[ConversationManager] Cleared conversation for ${key}`);
  }

  /**
   * Clear all conversations for a channel (all personalities)
   */
  clearChannelConversations(channelId: string): void {
    let cleared = 0;
    for (const key of this.conversations.keys()) {
      if (key.startsWith(`${channelId}:`)) {
        this.conversations.delete(key);
        cleared++;
      }
    }
    logger.info(`[ConversationManager] Cleared ${cleared} conversations for channel ${channelId}`);
  }

  /**
   * Get or create a thread
   */
  private getOrCreateThread(key: string): ConversationThread {
    let thread = this.conversations.get(key);

    if (thread === undefined) {
      thread = {
        messages: [],
      };
      this.conversations.set(key, thread);
      logger.debug(`[ConversationManager] Created new thread: ${key}`);
    }

    return thread;
  }

  /**
   * Get statistics about current conversations
   */
  getStats(): { totalThreads: number; totalMessages: number } {
    let totalMessages = 0;
    for (const thread of this.conversations.values()) {
      totalMessages += thread.messages.length;
    }

    return {
      totalThreads: this.conversations.size,
      totalMessages,
    };
  }

  /**
   * Clear all conversations (useful for shutdown/reset)
   */
  destroy(): void {
    this.conversations.clear();
    logger.info('[ConversationManager] Destroyed');
  }
}
