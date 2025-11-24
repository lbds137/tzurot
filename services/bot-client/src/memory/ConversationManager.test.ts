/**
 * ConversationManager Unit Tests
 *
 * Tests in-memory conversation tracking per channel/personality.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationManager } from './ConversationManager.js';
import { MessageRole } from '@tzurot/common-types';

// Mock logger
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  };
});

describe('ConversationManager', () => {
  let manager: ConversationManager;

  beforeEach(() => {
    manager = new ConversationManager();
  });

  describe('constructor', () => {
    it('should use default maxMessagesPerThread of 20', () => {
      const newManager = new ConversationManager();
      // Add 25 messages and verify only 20 are kept
      for (let i = 0; i < 25; i++) {
        newManager.addUserMessage('channel-1', 'personality-1', `message-${i}`);
      }
      const history = newManager.getHistory('channel-1', 'personality-1');
      expect(history).toHaveLength(20);
      // Should keep the most recent (messages 5-24)
      expect(history[0].content).toBe('message-5');
      expect(history[19].content).toBe('message-24');
    });

    it('should accept custom maxMessagesPerThread', () => {
      const customManager = new ConversationManager({ maxMessagesPerThread: 5 });
      for (let i = 0; i < 10; i++) {
        customManager.addUserMessage('channel-1', 'personality-1', `message-${i}`);
      }
      const history = customManager.getHistory('channel-1', 'personality-1');
      expect(history).toHaveLength(5);
      // Should keep the most recent (messages 5-9)
      expect(history[0].content).toBe('message-5');
      expect(history[4].content).toBe('message-9');
    });
  });

  describe('addUserMessage', () => {
    it('should add user message to conversation', () => {
      manager.addUserMessage('channel-1', 'lilith', 'hello');

      const history = manager.getHistory('channel-1', 'lilith');
      expect(history).toHaveLength(1);
      expect(history[0]).toEqual({
        role: MessageRole.User,
        content: 'hello',
      });
    });

    it('should add multiple user messages', () => {
      manager.addUserMessage('channel-1', 'lilith', 'first');
      manager.addUserMessage('channel-1', 'lilith', 'second');

      const history = manager.getHistory('channel-1', 'lilith');
      expect(history).toHaveLength(2);
      expect(history[0].content).toBe('first');
      expect(history[1].content).toBe('second');
    });

    it('should keep conversations separate by channel', () => {
      manager.addUserMessage('channel-1', 'lilith', 'channel 1 message');
      manager.addUserMessage('channel-2', 'lilith', 'channel 2 message');

      const history1 = manager.getHistory('channel-1', 'lilith');
      const history2 = manager.getHistory('channel-2', 'lilith');

      expect(history1).toHaveLength(1);
      expect(history1[0].content).toBe('channel 1 message');
      expect(history2).toHaveLength(1);
      expect(history2[0].content).toBe('channel 2 message');
    });

    it('should keep conversations separate by personality', () => {
      manager.addUserMessage('channel-1', 'lilith', 'message to lilith');
      manager.addUserMessage('channel-1', 'sarcastic', 'message to sarcastic');

      const lilithHistory = manager.getHistory('channel-1', 'lilith');
      const sarcasticHistory = manager.getHistory('channel-1', 'sarcastic');

      expect(lilithHistory).toHaveLength(1);
      expect(lilithHistory[0].content).toBe('message to lilith');
      expect(sarcasticHistory).toHaveLength(1);
      expect(sarcasticHistory[0].content).toBe('message to sarcastic');
    });
  });

  describe('addAssistantMessage', () => {
    it('should add assistant message to conversation', () => {
      manager.addAssistantMessage('channel-1', 'lilith', 'hello human');

      const history = manager.getHistory('channel-1', 'lilith');
      expect(history).toHaveLength(1);
      expect(history[0]).toEqual({
        role: MessageRole.Assistant,
        content: 'hello human',
      });
    });

    it('should maintain message order with mixed roles', () => {
      manager.addUserMessage('channel-1', 'lilith', 'user message 1');
      manager.addAssistantMessage('channel-1', 'lilith', 'assistant response 1');
      manager.addUserMessage('channel-1', 'lilith', 'user message 2');
      manager.addAssistantMessage('channel-1', 'lilith', 'assistant response 2');

      const history = manager.getHistory('channel-1', 'lilith');
      expect(history).toHaveLength(4);
      expect(history[0]).toEqual({ role: MessageRole.User, content: 'user message 1' });
      expect(history[1]).toEqual({ role: MessageRole.Assistant, content: 'assistant response 1' });
      expect(history[2]).toEqual({ role: MessageRole.User, content: 'user message 2' });
      expect(history[3]).toEqual({ role: MessageRole.Assistant, content: 'assistant response 2' });
    });
  });

  describe('getHistory', () => {
    it('should return empty array for non-existent conversation', () => {
      const history = manager.getHistory('non-existent', 'personality');
      expect(history).toEqual([]);
    });

    it('should return messages without timestamps', () => {
      manager.addUserMessage('channel-1', 'lilith', 'test');
      const history = manager.getHistory('channel-1', 'lilith');

      expect(history[0]).toEqual({
        role: MessageRole.User,
        content: 'test',
      });
      // Should NOT have timestamp property
      expect(history[0]).not.toHaveProperty('timestamp');
    });
  });

  describe('clearConversation', () => {
    it('should clear specific conversation', () => {
      manager.addUserMessage('channel-1', 'lilith', 'message 1');
      manager.addUserMessage('channel-1', 'sarcastic', 'message 2');

      manager.clearConversation('channel-1', 'lilith');

      expect(manager.getHistory('channel-1', 'lilith')).toEqual([]);
      expect(manager.getHistory('channel-1', 'sarcastic')).toHaveLength(1);
    });

    it('should handle clearing non-existent conversation gracefully', () => {
      expect(() => {
        manager.clearConversation('non-existent', 'personality');
      }).not.toThrow();
    });
  });

  describe('clearChannelConversations', () => {
    it('should clear all conversations for a channel', () => {
      manager.addUserMessage('channel-1', 'lilith', 'message 1');
      manager.addUserMessage('channel-1', 'sarcastic', 'message 2');
      manager.addUserMessage('channel-2', 'lilith', 'message 3');

      manager.clearChannelConversations('channel-1');

      expect(manager.getHistory('channel-1', 'lilith')).toEqual([]);
      expect(manager.getHistory('channel-1', 'sarcastic')).toEqual([]);
      // Channel 2 should be unaffected
      expect(manager.getHistory('channel-2', 'lilith')).toHaveLength(1);
    });

    it('should handle clearing channel with no conversations gracefully', () => {
      expect(() => {
        manager.clearChannelConversations('non-existent-channel');
      }).not.toThrow();
    });
  });

  describe('getStats', () => {
    it('should return zero stats for empty manager', () => {
      const stats = manager.getStats();
      expect(stats).toEqual({
        totalThreads: 0,
        totalMessages: 0,
      });
    });

    it('should return correct stats', () => {
      manager.addUserMessage('channel-1', 'lilith', 'message 1');
      manager.addAssistantMessage('channel-1', 'lilith', 'response 1');
      manager.addUserMessage('channel-2', 'sarcastic', 'message 2');

      const stats = manager.getStats();
      expect(stats).toEqual({
        totalThreads: 2,
        totalMessages: 3,
      });
    });
  });

  describe('destroy', () => {
    it('should clear all conversations', () => {
      manager.addUserMessage('channel-1', 'lilith', 'message 1');
      manager.addUserMessage('channel-2', 'sarcastic', 'message 2');

      manager.destroy();

      expect(manager.getHistory('channel-1', 'lilith')).toEqual([]);
      expect(manager.getHistory('channel-2', 'sarcastic')).toEqual([]);
      expect(manager.getStats().totalThreads).toBe(0);
    });
  });

  describe('message trimming', () => {
    it('should trim oldest messages when exceeding max', () => {
      const smallManager = new ConversationManager({ maxMessagesPerThread: 3 });

      smallManager.addUserMessage('ch', 'p', 'msg-1');
      smallManager.addAssistantMessage('ch', 'p', 'resp-1');
      smallManager.addUserMessage('ch', 'p', 'msg-2');
      // Now at 3, next one should trim
      smallManager.addAssistantMessage('ch', 'p', 'resp-2');

      const history = smallManager.getHistory('ch', 'p');
      expect(history).toHaveLength(3);
      // msg-1 should be trimmed, keeping resp-1, msg-2, resp-2
      expect(history[0].content).toBe('resp-1');
      expect(history[1].content).toBe('msg-2');
      expect(history[2].content).toBe('resp-2');
    });

    it('should trim from both user and assistant additions', () => {
      const smallManager = new ConversationManager({ maxMessagesPerThread: 2 });

      smallManager.addUserMessage('ch', 'p', 'user-1');
      smallManager.addUserMessage('ch', 'p', 'user-2');
      smallManager.addAssistantMessage('ch', 'p', 'assistant-1');

      const history = smallManager.getHistory('ch', 'p');
      expect(history).toHaveLength(2);
      expect(history[0].content).toBe('user-2');
      expect(history[1].content).toBe('assistant-1');
    });
  });

  describe('edge cases', () => {
    it('should handle empty content', () => {
      manager.addUserMessage('channel-1', 'lilith', '');
      const history = manager.getHistory('channel-1', 'lilith');
      expect(history).toHaveLength(1);
      expect(history[0].content).toBe('');
    });

    it('should handle special characters in content', () => {
      const specialContent = '🎉 Hello <script>alert("xss")</script> & "quotes"';
      manager.addUserMessage('channel-1', 'lilith', specialContent);
      const history = manager.getHistory('channel-1', 'lilith');
      expect(history[0].content).toBe(specialContent);
    });

    it('should handle very long content', () => {
      const longContent = 'a'.repeat(10000);
      manager.addUserMessage('channel-1', 'lilith', longContent);
      const history = manager.getHistory('channel-1', 'lilith');
      expect(history[0].content).toBe(longContent);
    });

    it('should handle special characters in channel and personality names', () => {
      manager.addUserMessage('channel:with:colons', 'personality-with-dashes', 'test');
      const history = manager.getHistory('channel:with:colons', 'personality-with-dashes');
      expect(history).toHaveLength(1);
    });
  });
});
