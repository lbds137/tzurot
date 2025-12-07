/**
 * Tests for Conversation Utilities
 *
 * Tests helper functions for processing conversation history and participants:
 * - extractParticipants: Extract unique personas from conversation
 * - convertConversationHistory: Convert to LangChain BaseMessage format
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import {
  extractParticipants,
  convertConversationHistory,
  type Participant,
} from './conversationUtils.js';
import { MessageRole } from '@tzurot/common-types';

// Mock common-types
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
    formatRelativeTime: vi.fn((timestamp: string) => {
      // Simple mock that returns a formatted string
      return 'just now';
    }),
  };
});

describe('Conversation Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('extractParticipants', () => {
    it('should return empty array for empty history', () => {
      const participants = extractParticipants([]);

      expect(participants).toEqual([]);
    });

    it('should extract unique participants from user messages', () => {
      const history = [
        {
          role: MessageRole.User,
          content: 'Hello',
          personaId: 'persona-1',
          personaName: 'Alice',
        },
        {
          role: MessageRole.User,
          content: 'Hi there',
          personaId: 'persona-2',
          personaName: 'Bob',
        },
        {
          role: MessageRole.Assistant,
          content: 'Hello!',
        },
      ];

      const participants = extractParticipants(history);

      expect(participants).toHaveLength(2);
      expect(participants).toContainEqual({
        personaId: 'persona-1',
        personaName: 'Alice',
        isActive: false,
      });
      expect(participants).toContainEqual({
        personaId: 'persona-2',
        personaName: 'Bob',
        isActive: false,
      });
    });

    it('should mark active persona correctly', () => {
      const history = [
        {
          role: MessageRole.User,
          content: 'Hello',
          personaId: 'persona-1',
          personaName: 'Alice',
        },
      ];

      const participants = extractParticipants(history, 'persona-1', 'Alice');

      expect(participants).toHaveLength(1);
      expect(participants[0]).toEqual({
        personaId: 'persona-1',
        personaName: 'Alice',
        isActive: true,
      });
    });

    it('should include active persona even if not in history', () => {
      const history = [
        {
          role: MessageRole.User,
          content: 'Hello',
          personaId: 'persona-1',
          personaName: 'Alice',
        },
      ];

      const participants = extractParticipants(history, 'persona-new', 'NewUser');

      expect(participants).toHaveLength(2);
      expect(participants).toContainEqual({
        personaId: 'persona-1',
        personaName: 'Alice',
        isActive: false,
      });
      expect(participants).toContainEqual({
        personaId: 'persona-new',
        personaName: 'NewUser',
        isActive: true,
      });
    });

    it('should deduplicate same persona appearing multiple times', () => {
      const history = [
        {
          role: MessageRole.User,
          content: 'Hello',
          personaId: 'persona-1',
          personaName: 'Alice',
        },
        {
          role: MessageRole.User,
          content: 'How are you?',
          personaId: 'persona-1',
          personaName: 'Alice',
        },
        {
          role: MessageRole.User,
          content: 'Fine thanks',
          personaId: 'persona-1',
          personaName: 'Alice',
        },
      ];

      const participants = extractParticipants(history);

      expect(participants).toHaveLength(1);
      expect(participants[0].personaId).toBe('persona-1');
    });

    it('should ignore messages without personaId', () => {
      const history = [
        {
          role: MessageRole.User,
          content: 'Hello',
          personaName: 'Alice',
          // No personaId
        },
        {
          role: MessageRole.User,
          content: 'Hi',
          personaId: 'persona-1',
          personaName: 'Bob',
        },
      ];

      const participants = extractParticipants(history);

      expect(participants).toHaveLength(1);
      expect(participants[0].personaId).toBe('persona-1');
    });

    it('should ignore messages without personaName', () => {
      const history = [
        {
          role: MessageRole.User,
          content: 'Hello',
          personaId: 'persona-1',
          // No personaName
        },
        {
          role: MessageRole.User,
          content: 'Hi',
          personaId: 'persona-2',
          personaName: 'Bob',
        },
      ];

      const participants = extractParticipants(history);

      expect(participants).toHaveLength(1);
      expect(participants[0].personaId).toBe('persona-2');
    });

    it('should ignore messages with empty personaId or personaName', () => {
      const history = [
        {
          role: MessageRole.User,
          content: 'Hello',
          personaId: '',
          personaName: 'Alice',
        },
        {
          role: MessageRole.User,
          content: 'Hi',
          personaId: 'persona-1',
          personaName: '',
        },
      ];

      const participants = extractParticipants(history);

      expect(participants).toHaveLength(0);
    });

    it('should not include active persona if it has empty id or name', () => {
      const history: Parameters<typeof extractParticipants>[0] = [];

      const participants1 = extractParticipants(history, '', 'Alice');
      expect(participants1).toHaveLength(0);

      const participants2 = extractParticipants(history, 'persona-1', '');
      expect(participants2).toHaveLength(0);
    });

    it('should ignore assistant messages', () => {
      const history = [
        {
          role: MessageRole.Assistant,
          content: 'Hello',
          personaId: 'bot-1',
          personaName: 'Bot',
        },
      ];

      const participants = extractParticipants(history);

      expect(participants).toHaveLength(0);
    });
  });

  describe('convertConversationHistory', () => {
    it('should convert empty history to empty array', () => {
      const result = convertConversationHistory([], 'TestBot');

      expect(result).toEqual([]);
    });

    it('should convert user messages to HumanMessage', () => {
      const history = [
        {
          role: MessageRole.User,
          content: 'Hello',
        },
      ];

      const result = convertConversationHistory(history, 'TestBot');

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(HumanMessage);
      expect(result[0].content).toBe('Hello');
    });

    it('should convert assistant messages to AIMessage', () => {
      const history = [
        {
          role: MessageRole.Assistant,
          content: 'Hi there!',
        },
      ];

      const result = convertConversationHistory(history, 'TestBot');

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(AIMessage);
      expect(result[0].content).toContain('TestBot:');
      expect(result[0].content).toContain('Hi there!');
    });

    it('should include persona name in user messages', () => {
      const history = [
        {
          role: MessageRole.User,
          content: 'Hello',
          personaName: 'Alice',
        },
      ];

      const result = convertConversationHistory(history, 'TestBot');

      expect(result).toHaveLength(1);
      expect(result[0].content).toContain('Alice:');
      expect(result[0].content).toContain('Hello');
    });

    it('should include timestamp in user messages when available', () => {
      const history = [
        {
          role: MessageRole.User,
          content: 'Hello',
          personaName: 'Alice',
          createdAt: '2025-01-01T00:00:00Z',
        },
      ];

      const result = convertConversationHistory(history, 'TestBot');

      expect(result).toHaveLength(1);
      expect(result[0].content).toContain('[just now]'); // Mocked formatRelativeTime
    });

    it('should include timestamp in assistant messages when available', () => {
      const history = [
        {
          role: MessageRole.Assistant,
          content: 'Hello there!',
          createdAt: '2025-01-01T00:00:00Z',
        },
      ];

      const result = convertConversationHistory(history, 'TestBot');

      expect(result).toHaveLength(1);
      expect(result[0].content).toContain('TestBot:');
      expect(result[0].content).toContain('[just now]');
    });

    it('should convert system messages to HumanMessage', () => {
      const history = [
        {
          role: MessageRole.System,
          content: 'System notice',
        },
      ];

      const result = convertConversationHistory(history, 'TestBot');

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(HumanMessage);
    });

    it('should handle mixed conversation', () => {
      const history = [
        {
          role: MessageRole.User,
          content: 'Hello',
          personaName: 'Alice',
        },
        {
          role: MessageRole.Assistant,
          content: 'Hi Alice!',
        },
        {
          role: MessageRole.User,
          content: 'How are you?',
          personaName: 'Alice',
        },
        {
          role: MessageRole.Assistant,
          content: "I'm doing great!",
        },
      ];

      const result = convertConversationHistory(history, 'TestBot');

      expect(result).toHaveLength(4);
      expect(result[0]).toBeInstanceOf(HumanMessage);
      expect(result[1]).toBeInstanceOf(AIMessage);
      expect(result[2]).toBeInstanceOf(HumanMessage);
      expect(result[3]).toBeInstanceOf(AIMessage);
    });

    it('should handle user message without persona name', () => {
      const history = [
        {
          role: MessageRole.User,
          content: 'Hello',
          createdAt: '2025-01-01T00:00:00Z',
        },
      ];

      const result = convertConversationHistory(history, 'TestBot');

      expect(result).toHaveLength(1);
      // Should still have timestamp
      expect(result[0].content).toContain('[just now]');
      expect(result[0].content).toContain('Hello');
    });

    it('should preserve original content when no metadata', () => {
      const history = [
        {
          role: MessageRole.User,
          content: 'Plain message',
        },
      ];

      const result = convertConversationHistory(history, 'TestBot');

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Plain message');
    });
  });
});
