/**
 * Conversation Manager
 *
 * Tracks conversation history per channel for context-aware responses.
 * Uses LRU-style memory management to prevent unbounded growth.
 */

import { createLogger } from '@tzurot/common-types';

const logger = createLogger('ConversationManager');

interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

interface ConversationThread {
  messages: ConversationMessage[];
  lastActivity: number;
}

export class ConversationManager {
  private conversations = new Map<string, ConversationThread>();
  private readonly maxMessagesPerThread: number;
  private readonly threadTimeout: number;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(options: {
    maxMessagesPerThread?: number;
    threadTimeoutMinutes?: number;
  } = {}) {
    this.maxMessagesPerThread = options.maxMessagesPerThread ?? 20; // Keep last 20 messages
    this.threadTimeout = (options.threadTimeoutMinutes ?? 60) * 60 * 1000; // 1 hour default

    this.startCleanup();
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
      role: 'user',
      content,
      timestamp: Date.now()
    });

    // Trim to max length (keep most recent)
    if (thread.messages.length > this.maxMessagesPerThread) {
      thread.messages = thread.messages.slice(-this.maxMessagesPerThread);
    }

    thread.lastActivity = Date.now();

    logger.debug(`[ConversationManager] Added user message to ${key} (${thread.messages.length} total)`);
  }

  /**
   * Add an assistant response to the conversation
   */
  addAssistantMessage(channelId: string, personalityName: string, content: string): void {
    const key = this.getKey(channelId, personalityName);
    const thread = this.getOrCreateThread(key);

    thread.messages.push({
      role: 'assistant',
      content,
      timestamp: Date.now()
    });

    // Trim to max length
    if (thread.messages.length > this.maxMessagesPerThread) {
      thread.messages = thread.messages.slice(-this.maxMessagesPerThread);
    }

    thread.lastActivity = Date.now();

    logger.debug(`[ConversationManager] Added assistant message to ${key} (${thread.messages.length} total)`);
  }

  /**
   * Get conversation history for a channel + personality
   */
  getHistory(channelId: string, personalityName: string): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
    const key = this.getKey(channelId, personalityName);
    const thread = this.conversations.get(key);

    if (thread === undefined) {
      return [];
    }

    // Update last activity
    thread.lastActivity = Date.now();

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
        lastActivity: Date.now()
      };
      this.conversations.set(key, thread);
      logger.debug(`[ConversationManager] Created new thread: ${key}`);
    }

    return thread;
  }

  /**
   * Start periodic cleanup of old threads
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredThreads();
    }, 5 * 60 * 1000); // Clean every 5 minutes

    // Allow Node.js to exit even with active interval
    this.cleanupInterval.unref();
  }

  /**
   * Clean up threads that haven't been active recently
   */
  private cleanupExpiredThreads(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, thread] of this.conversations.entries()) {
      if (now - thread.lastActivity > this.threadTimeout) {
        this.conversations.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info(`[ConversationManager] Cleaned up ${cleaned} expired conversation threads`);
    }
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
      totalMessages
    };
  }

  /**
   * Stop cleanup interval and clear all conversations
   */
  destroy(): void {
    if (this.cleanupInterval !== undefined) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    this.conversations.clear();
    logger.info('[ConversationManager] Destroyed');
  }
}
