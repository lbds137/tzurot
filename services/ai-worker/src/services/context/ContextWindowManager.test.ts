import { describe, it, expect, beforeEach } from 'vitest';
import { ContextWindowManager } from './ContextWindowManager.js';
import { MessageRole } from '@tzurot/common-types';

describe('ContextWindowManager', () => {
  let manager: ContextWindowManager;

  beforeEach(() => {
    manager = new ContextWindowManager();
  });

  describe('calculateHistoryBudget', () => {
    it('should calculate correct budget breakdown', () => {
      // 1000 total - 200 system - 100 current - 50 memory = 650 history budget
      const budget = manager.calculateHistoryBudget(1000, 200, 100, 50);

      expect(budget).toBe(650);
    });

    it('should clamp to zero when components exceed context window', () => {
      // 100 total - 500 system - 300 current - 0 memory = -700, clamped to 0
      const budget = manager.calculateHistoryBudget(100, 500, 300, 0);

      expect(budget).toBe(0);
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

    it('should not count wrapper overhead when no current-channel messages fit budget', () => {
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
              personaName: 'User',
              tokenCount: 5,
            },
          ],
        },
      ];

      // Budget is too small for the rawHistory entry but enough for cross-channel
      const rawHistory = [{ role: 'user', content: 'A'.repeat(4000), tokenCount: 2000 }];

      const budget = 100;
      const result = manager.selectAndSerializeHistory(
        rawHistory as Parameters<typeof manager.selectAndSerializeHistory>[0],
        'TestAI',
        budget,
        crossChannelGroups
      );

      // No current-channel messages fit, so no wrapper overhead should be counted
      // Cross-channel should still be included (gets the full budget)
      expect(result.messagesIncluded).toBe(0);
      expect(result.serializedHistory).toContain('DM message');
      expect(result.serializedHistory).not.toContain('<chat_log>');
    });

    it('should return empty when rawHistory is empty and no cross-channel groups', () => {
      const result = manager.selectAndSerializeHistory([], 'TestAI', 5000);

      expect(result.serializedHistory).toBe('');
      expect(result.historyTokensUsed).toBe(0);
    });
  });
});
