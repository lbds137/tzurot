import { describe, it, expect, beforeEach } from 'vitest';
import { ContextWindowManager } from './ContextWindowManager.js';
import { MessageRole, type DiscordEnvironment } from '@tzurot/common-types';

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

    it('should return empty when budget is 0 even with both current and cross-channel history', () => {
      const rawHistory = [
        { role: 'user', content: 'Hi', createdAt: '2026-02-27T10:00:00Z', tokenCount: 5 },
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
              content: 'Cross message',
              createdAt: '2026-02-26T10:00:00Z',
              tokenCount: 5,
            },
          ],
        },
      ];

      const result = manager.selectAndSerializeHistory(rawHistory, 'TestAI', 0, crossChannelGroups);

      expect(result.serializedHistory).toBe('');
      expect(result.messagesDropped).toBe(1);
      expect(result.crossChannelMessagesIncluded).toBe(0);
    });

    it('should return empty current-channel when budget barely covers wrapper overhead', () => {
      const rawHistory = [
        { role: 'user', content: 'Hello', createdAt: '2026-02-26T10:00:00Z', tokenCount: 5 },
      ];

      // Budget of 2 is positive (passes the historyBudget <= 0 check) but smaller than
      // the <chat_log> wrapper overhead (~3+ tokens), so budgetAfterOverhead <= 0
      const result = manager.selectAndSerializeHistory(rawHistory, 'TestAI', 2);

      expect(result.serializedHistory).toBe('');
      expect(result.messagesIncluded).toBe(0);
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

    it('should not add <current_conversation> wrapper when no environment is provided', () => {
      const rawHistory = [
        { role: 'user', content: 'Hello', createdAt: '2026-02-26T10:00:00Z', tokenCount: 5 },
      ];

      const result = manager.selectAndSerializeHistory(rawHistory, 'TestAI', 1000);

      expect(result.serializedHistory).toContain('Hello');
      expect(result.serializedHistory).not.toContain('<current_conversation>');
      expect(result.serializedHistory).not.toContain('<location');
    });

    it('should wrap current channel in <current_conversation> with location when environment is provided', () => {
      const rawHistory = [
        { role: 'user', content: 'Hello', createdAt: '2026-02-26T10:00:00Z', tokenCount: 5 },
        {
          role: 'assistant',
          content: 'Hi there!',
          createdAt: '2026-02-26T10:01:00Z',
          tokenCount: 5,
        },
      ];
      const environment: DiscordEnvironment = {
        type: 'guild',
        guild: { id: 'g-1', name: 'Test Server' },
        channel: { id: 'ch-1', name: 'chat', type: 'text' },
      };

      const result = manager.selectAndSerializeHistory(
        rawHistory,
        'TestAI',
        1000,
        undefined,
        environment
      );

      expect(result.serializedHistory).toContain('<current_conversation>');
      expect(result.serializedHistory).toContain('</current_conversation>');
      expect(result.serializedHistory).toContain('<location type="guild">');
      expect(result.serializedHistory).toContain('<server name="Test Server"/>');
      expect(result.serializedHistory).toContain('<channel name="chat" type="text"/>');
      expect(result.serializedHistory).toContain('Hello');
      expect(result.serializedHistory).toContain('Hi there!');
      expect(result.messagesIncluded).toBe(2);
    });

    it('should wrap current channel with DM location', () => {
      const rawHistory = [
        { role: 'user', content: 'DM hello', createdAt: '2026-02-26T10:00:00Z', tokenCount: 5 },
      ];
      const environment: DiscordEnvironment = {
        type: 'dm',
        channel: { id: 'dm-1', name: 'DM', type: 'dm' },
      };

      const result = manager.selectAndSerializeHistory(
        rawHistory,
        'TestAI',
        1000,
        undefined,
        environment
      );

      expect(result.serializedHistory).toContain('<current_conversation>');
      expect(result.serializedHistory).toContain(
        '<location type="dm">Direct Message (private one-on-one chat)</location>'
      );
      expect(result.serializedHistory).toContain('DM hello');
    });

    it('should combine cross-channel and current_conversation wrapper correctly', () => {
      const rawHistory = [
        {
          role: 'user',
          content: 'Current msg',
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
              content: 'Cross msg',
              createdAt: '2026-02-26T10:00:00Z',
              personaName: 'User',
              tokenCount: 10,
            },
          ],
        },
      ];
      const environment: DiscordEnvironment = {
        type: 'guild',
        guild: { id: 'g-1', name: 'Server' },
        channel: { id: 'ch-current', name: 'dev', type: 'text' },
      };

      const result = manager.selectAndSerializeHistory(
        rawHistory,
        'TestAI',
        5000,
        crossChannelGroups,
        environment
      );

      // Cross-channel should come first (prior_conversations)
      expect(result.serializedHistory).toContain('<prior_conversations>');
      // Current channel should be wrapped in <current_conversation>
      expect(result.serializedHistory).toContain('<current_conversation>');
      expect(result.serializedHistory).toContain('<channel name="dev" type="text"/>');

      // Verify ordering: prior_conversations before current_conversation
      const priorIdx = result.serializedHistory.indexOf('<prior_conversations>');
      const currentIdx = result.serializedHistory.indexOf('<current_conversation>');
      expect(priorIdx).toBeLessThan(currentIdx);
    });

    it('should not add <current_conversation> wrapper when no current messages fit budget', () => {
      const rawHistory = [{ role: 'user', content: 'A'.repeat(4000), tokenCount: 2000 }];
      const environment: DiscordEnvironment = {
        type: 'dm',
        channel: { id: 'dm-1', name: 'DM', type: 'dm' },
      };

      const result = manager.selectAndSerializeHistory(
        rawHistory as Parameters<typeof manager.selectAndSerializeHistory>[0],
        'TestAI',
        10,
        undefined,
        environment
      );

      // No messages fit, so no wrapper should be added
      expect(result.serializedHistory).toBe('');
      expect(result.messagesIncluded).toBe(0);
    });

    it('should account for <current_conversation> wrapper overhead in token budget', () => {
      const rawHistory = [
        { role: 'user', content: 'Hello', createdAt: '2026-02-26T10:00:00Z', tokenCount: 5 },
      ];
      const environment: DiscordEnvironment = {
        type: 'guild',
        guild: { id: 'g-1', name: 'Test Server' },
        channel: { id: 'ch-1', name: 'chat', type: 'text' },
      };

      const withEnv = manager.selectAndSerializeHistory(
        rawHistory,
        'TestAI',
        1000,
        undefined,
        environment
      );
      const withoutEnv = manager.selectAndSerializeHistory(rawHistory, 'TestAI', 1000);

      // With environment should use more tokens due to wrapper overhead
      expect(withEnv.historyTokensUsed).toBeGreaterThan(withoutEnv.historyTokensUsed);
    });
  });
});
