import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContextWindowManager } from './ContextWindowManager.js';
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { MessageRole } from '@tzurot/common-types';
import type { ContextWindowInput } from './ContextWindowManager.js';
import type { MemoryDocument } from './PromptContext.js';

// Mock formatTimestampWithDelta used by MemoryFormatter
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    formatTimestampWithDelta: vi.fn((_date: Date) => ({
      absolute: 'Mon, Jan 15, 2024',
      relative: '2 weeks ago',
    })),
  };
});

describe('ContextWindowManager', () => {
  let manager: ContextWindowManager;

  beforeEach(() => {
    manager = new ContextWindowManager();
  });

  describe('buildContext', () => {
    it('should build context with all components within budget', () => {
      const input: ContextWindowInput = {
        systemPrompt: new SystemMessage('You are a helpful assistant.'),
        currentMessage: new HumanMessage('Hello, how are you?'),
        relevantMemories: [],
        conversationHistory: [
          new HumanMessage('Previous message 1'),
          new AIMessage('Previous response 1'),
        ],
        rawConversationHistory: [
          { role: 'user', content: 'Previous message 1', tokenCount: 5 },
          { role: 'assistant', content: 'Previous response 1', tokenCount: 5 },
        ],
        contextWindowTokens: 1000,
      };

      const context = manager.buildContext(input);

      expect(context.systemPrompt).toBe(input.systemPrompt);
      expect(context.currentMessage).toBe(input.currentMessage);
      expect(context.selectedHistory).toHaveLength(2);
      expect(context.tokenBudget.contextWindowTokens).toBe(1000);
      expect(context.metadata.messagesIncluded).toBe(2);
      expect(context.metadata.messagesDropped).toBe(0);
      expect(context.metadata.strategy).toBe('recency');
    });

    it('should limit history when budget is tight', () => {
      const input: ContextWindowInput = {
        systemPrompt: new SystemMessage('You are a helpful assistant.'),
        currentMessage: new HumanMessage('Hello!'),
        relevantMemories: [],
        conversationHistory: [
          new HumanMessage('Message 1'),
          new AIMessage('Response 1'),
          new HumanMessage('Message 2'),
          new AIMessage('Response 2'),
        ],
        rawConversationHistory: [
          { role: 'user', content: 'Message 1', tokenCount: 100 },
          { role: 'assistant', content: 'Response 1', tokenCount: 100 },
          { role: 'user', content: 'Message 2', tokenCount: 100 },
          { role: 'assistant', content: 'Response 2', tokenCount: 100 },
        ],
        contextWindowTokens: 300, // Very tight budget
      };

      const context = manager.buildContext(input);

      // Should drop older messages to fit budget
      expect(context.selectedHistory.length).toBeLessThan(4);
      expect(context.metadata.messagesDropped).toBeGreaterThan(0);
      expect(context.tokenBudget.historyTokensUsed).toBeLessThanOrEqual(
        context.tokenBudget.historyBudget
      );
    });

    it('should include no history when budget is zero', () => {
      const input: ContextWindowInput = {
        systemPrompt: new SystemMessage('Long system prompt'.repeat(100)),
        currentMessage: new HumanMessage('Long message'.repeat(100)),
        relevantMemories: [],
        conversationHistory: [new HumanMessage('Will be dropped')],
        rawConversationHistory: [{ role: 'user', content: 'Will be dropped', tokenCount: 50 }],
        contextWindowTokens: 500, // System + current consume all budget
      };

      const context = manager.buildContext(input);

      expect(context.selectedHistory).toHaveLength(0);
      expect(context.metadata.messagesIncluded).toBe(0);
      expect(context.metadata.messagesDropped).toBe(1);
    });

    it('should work backwards from newest message', () => {
      const input: ContextWindowInput = {
        systemPrompt: new SystemMessage('System'),
        currentMessage: new HumanMessage('Current'),
        relevantMemories: [],
        conversationHistory: [
          new HumanMessage('Oldest'),
          new AIMessage('Middle'),
          new HumanMessage('Newest'),
        ],
        rawConversationHistory: [
          { role: 'user', content: 'Oldest', tokenCount: 50 },
          { role: 'assistant', content: 'Middle', tokenCount: 50 },
          { role: 'user', content: 'Newest', tokenCount: 50 },
        ],
        contextWindowTokens: 120, // Tight budget: only newest + middle fit (not oldest)
      };

      const context = manager.buildContext(input);

      // Should include newest messages first, dropping oldest
      expect(context.selectedHistory).toHaveLength(2);
      // First message should be "Middle" (2nd in original array)
      expect(context.selectedHistory[0].content).toBe('Middle');
      expect(context.selectedHistory[1].content).toBe('Newest');
      expect(context.metadata.messagesDropped).toBe(1);
    });

    it('should count memory tokens with timestamps', () => {
      // Use fixed timestamps for deterministic tests (avoid Date.now() which can cause flaky token counts)
      const fixedTimestamp = new Date('2024-06-15T12:00:00Z').getTime();
      const memories: MemoryDocument[] = [
        {
          pageContent: 'User likes pizza',
          metadata: { createdAt: fixedTimestamp },
        },
        {
          pageContent: 'User lives in NYC',
          metadata: { createdAt: fixedTimestamp },
        },
      ];

      const input: ContextWindowInput = {
        systemPrompt: new SystemMessage('System'),
        currentMessage: new HumanMessage('Current'),
        relevantMemories: memories,
        conversationHistory: [],
        contextWindowTokens: 1000,
      };

      const context = manager.buildContext(input);

      // Memories should consume tokens
      expect(context.tokenBudget.memoryTokens).toBeGreaterThan(0);
      // History budget should be reduced by memory tokens
      expect(context.tokenBudget.historyBudget).toBeLessThan(
        context.tokenBudget.contextWindowTokens -
          context.tokenBudget.systemPromptTokens -
          context.tokenBudget.currentMessageTokens
      );
    });

    it('should handle empty conversation history', () => {
      const input: ContextWindowInput = {
        systemPrompt: new SystemMessage('System'),
        currentMessage: new HumanMessage('Current'),
        relevantMemories: [],
        conversationHistory: [],
        contextWindowTokens: 1000,
      };

      const context = manager.buildContext(input);

      expect(context.selectedHistory).toHaveLength(0);
      expect(context.metadata.messagesIncluded).toBe(0);
      expect(context.metadata.messagesDropped).toBe(0);
      expect(context.tokenBudget.historyTokensUsed).toBe(0);
    });

    it('should use cached token counts when available', () => {
      const input: ContextWindowInput = {
        systemPrompt: new SystemMessage('System'),
        currentMessage: new HumanMessage('Current'),
        relevantMemories: [],
        conversationHistory: [new HumanMessage('Cached message')],
        rawConversationHistory: [
          { role: 'user', content: 'Cached message', tokenCount: 42 }, // Pre-computed
        ],
        contextWindowTokens: 1000,
      };

      const context = manager.buildContext(input);

      // Should use the cached tokenCount (42) rather than recomputing
      expect(context.tokenBudget.historyTokensUsed).toBe(42);
    });

    it('should compute token counts when not cached', () => {
      const input: ContextWindowInput = {
        systemPrompt: new SystemMessage('System'),
        currentMessage: new HumanMessage('Current'),
        relevantMemories: [],
        conversationHistory: [new HumanMessage('Uncached message')],
        rawConversationHistory: undefined, // No cached counts
        contextWindowTokens: 1000,
      };

      const context = manager.buildContext(input);

      // Should compute tokens from the BaseMessage content
      expect(context.tokenBudget.historyTokensUsed).toBeGreaterThan(0);
    });
  });

  describe('token budget calculation', () => {
    it('should calculate correct budget breakdown', () => {
      const input: ContextWindowInput = {
        systemPrompt: new SystemMessage('System prompt'),
        currentMessage: new HumanMessage('User message'),
        relevantMemories: [],
        conversationHistory: [],
        contextWindowTokens: 1000,
      };

      const context = manager.buildContext(input);

      expect(context.tokenBudget.contextWindowTokens).toBe(1000);
      expect(context.tokenBudget.systemPromptTokens).toBeGreaterThan(0);
      expect(context.tokenBudget.currentMessageTokens).toBeGreaterThan(0);
      expect(context.tokenBudget.memoryTokens).toBe(0);
      expect(context.tokenBudget.historyBudget).toBe(
        1000 - context.tokenBudget.systemPromptTokens - context.tokenBudget.currentMessageTokens
      );
    });

    it('should never have negative history budget', () => {
      const input: ContextWindowInput = {
        systemPrompt: new SystemMessage('Very long system prompt'.repeat(200)),
        currentMessage: new HumanMessage('Long message'.repeat(200)),
        relevantMemories: [],
        conversationHistory: [],
        contextWindowTokens: 100, // Impossibly small
      };

      const context = manager.buildContext(input);

      // Budget should be clamped to 0, not negative
      expect(context.tokenBudget.historyBudget).toBeGreaterThanOrEqual(0);
    });
  });

  describe('selectAndSerializeHistory', () => {
    it('should serialize current channel history as XML', () => {
      const rawHistory = [
        { role: 'user', content: 'Hello', createdAt: '2026-02-26T10:00:00Z', tokenCount: 5 },
        {
          role: 'assistant',
          content: 'Hi there!',
          createdAt: '2026-02-26T10:01:00Z',
          tokenCount: 5,
        },
      ];

      const result = manager.selectAndSerializeHistory(rawHistory, 'TestAI', 1000);

      expect(result.serializedHistory).toContain('Hello');
      expect(result.serializedHistory).toContain('Hi there!');
      expect(result.messagesIncluded).toBe(2);
      expect(result.messagesDropped).toBe(0);
      expect(result.historyTokensUsed).toBeGreaterThan(0);
    });

    it('should return empty when history is undefined', () => {
      const result = manager.selectAndSerializeHistory(undefined, 'TestAI', 1000);

      expect(result.serializedHistory).toBe('');
      expect(result.messagesIncluded).toBe(0);
    });

    it('should return empty when budget is 0', () => {
      const rawHistory = [
        { role: 'user', content: 'Hello', createdAt: '2026-02-26T10:00:00Z', tokenCount: 5 },
      ];

      const result = manager.selectAndSerializeHistory(rawHistory, 'TestAI', 0);

      expect(result.serializedHistory).toBe('');
      expect(result.messagesDropped).toBe(1);
    });

    it('should include cross-channel history when provided and budget remains', () => {
      const rawHistory = [
        {
          role: 'user',
          content: 'Current channel msg',
          createdAt: '2026-02-27T10:00:00Z',
          tokenCount: 10,
        },
      ];

      const crossChannelGroups = [
        {
          channelEnvironment: {
            type: 'guild' as const,
            guild: { id: 'g-1', name: 'Server' },
            channel: { id: 'ch-other', name: 'general', type: 'text' },
          },
          messages: [
            {
              role: MessageRole.User,
              content: 'Cross-channel message',
              createdAt: '2026-02-26T10:00:00Z',
              personaName: 'TestUser',
              tokenCount: 10,
            },
          ],
        },
      ];

      const result = manager.selectAndSerializeHistory(
        rawHistory,
        'TestAI',
        5000,
        crossChannelGroups
      );

      expect(result.serializedHistory).toContain('Current channel msg');
      expect(result.serializedHistory).toContain('Cross-channel message');
      expect(result.serializedHistory).toContain('<prior_conversations>');
      expect(result.historyTokensUsed).toBeGreaterThan(0);
    });

    it('should not include cross-channel history when budget is exhausted', () => {
      // Use a long message that consumes most of a tight budget
      const rawHistory = [
        {
          role: 'user',
          content: 'Hello there friend',
          createdAt: '2026-02-27T10:00:00Z',
          tokenCount: 5,
        },
      ];

      const crossChannelGroups = [
        {
          channelEnvironment: {
            type: 'dm' as const,
            channel: { id: 'dm-1', name: 'DM', type: 'dm' },
          },
          messages: [
            {
              role: MessageRole.User,
              content: 'DM message',
              createdAt: '2026-02-26T10:00:00Z',
              tokenCount: 500,
            },
          ],
        },
      ];

      // Budget that fits current channel but leaves no room for cross-channel (500 token message)
      const result = manager.selectAndSerializeHistory(
        rawHistory,
        'TestAI',
        50,
        crossChannelGroups
      );

      expect(result.messagesIncluded).toBe(1);
      expect(result.serializedHistory).not.toContain('DM message');
    });

    it('should include cross-channel history even when rawHistory is empty (fresh channel)', () => {
      const crossChannelGroups = [
        {
          channelEnvironment: {
            type: 'guild' as const,
            guild: { id: 'g-1', name: 'Server' },
            channel: { id: 'ch-other', name: 'general', type: 'text' },
          },
          messages: [
            {
              role: MessageRole.User,
              content: 'Previous conversation in another channel',
              createdAt: '2026-02-26T10:00:00Z',
              personaName: 'TestUser',
              tokenCount: 15,
            },
          ],
        },
      ];

      // rawHistory is empty (first message in new channel), but cross-channel exists
      const result = manager.selectAndSerializeHistory([], 'TestAI', 5000, crossChannelGroups);

      expect(result.serializedHistory).toContain('Previous conversation in another channel');
      expect(result.serializedHistory).toContain('<prior_conversations>');
      expect(result.historyTokensUsed).toBeGreaterThan(0);
      expect(result.messagesIncluded).toBe(0); // No current-channel messages
      expect(result.messagesDropped).toBe(0);
    });

    it('should return empty when rawHistory is empty and no cross-channel groups', () => {
      const result = manager.selectAndSerializeHistory([], 'TestAI', 5000);

      expect(result.serializedHistory).toBe('');
      expect(result.historyTokensUsed).toBe(0);
    });
  });
});
