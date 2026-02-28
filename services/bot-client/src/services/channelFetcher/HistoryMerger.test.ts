/**
 * Tests for HistoryMerger
 *
 * Unit tests for merging extended context messages with database history.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  recoverEmptyDbContent,
  enrichDbMessagesWithExtendedMetadata,
  mergeWithHistory,
} from './HistoryMerger.js';
import { MessageRole, type ConversationMessage } from '@tzurot/common-types';

/**
 * Create a minimal conversation message for testing
 */
function createMockMessage(overrides: {
  id?: string;
  discordMessageId?: string[];
  content?: string;
  role?: MessageRole;
  createdAt?: Date;
  personaId?: string;
  personaName?: string;
  messageMetadata?: {
    reactions?: Array<{
      emoji: string;
      isCustom: boolean;
      reactors: Array<{ personaId: string; displayName: string }>;
    }>;
    embedsXml?: string[];
    voiceTranscripts?: string[];
  };
}): ConversationMessage {
  return {
    id: overrides.id ?? 'msg-123',
    discordMessageId: overrides.discordMessageId ?? ['discord-123'],
    content: overrides.content ?? 'Test content',
    role: overrides.role ?? MessageRole.User,
    createdAt: overrides.createdAt ?? new Date('2024-01-01T12:00:00Z'),
    personaId: overrides.personaId ?? 'persona-123',
    personaName: overrides.personaName ?? 'TestUser',
    channelId: 'test-channel',
    guildId: 'test-guild',
    messageMetadata: overrides.messageMetadata,
  };
}

describe('HistoryMerger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('recoverEmptyDbContent', () => {
    it('should recover empty DB content from extended context', () => {
      const dbHistory = [
        createMockMessage({
          discordMessageId: ['msg-1'],
          content: '', // Empty content
        }),
      ];
      const extendedMessageMap = new Map<string, ConversationMessage>([
        [
          'msg-1',
          createMockMessage({
            discordMessageId: ['msg-1'],
            content: 'Recovered content from Discord',
          }),
        ],
      ]);

      const recoveredCount = recoverEmptyDbContent(dbHistory, extendedMessageMap);

      expect(recoveredCount).toBe(1);
      expect(dbHistory[0].content).toBe('Recovered content from Discord');
    });

    it('should not modify messages that already have content', () => {
      const dbHistory = [
        createMockMessage({
          discordMessageId: ['msg-1'],
          content: 'Existing DB content',
        }),
      ];
      const extendedMessageMap = new Map<string, ConversationMessage>([
        [
          'msg-1',
          createMockMessage({
            discordMessageId: ['msg-1'],
            content: 'Different extended content',
          }),
        ],
      ]);

      const recoveredCount = recoverEmptyDbContent(dbHistory, extendedMessageMap);

      expect(recoveredCount).toBe(0);
      expect(dbHistory[0].content).toBe('Existing DB content');
    });

    it('should copy voice transcripts during recovery', () => {
      const dbHistory = [
        createMockMessage({
          discordMessageId: ['msg-1'],
          content: '',
        }),
      ];
      const extendedMessageMap = new Map<string, ConversationMessage>([
        [
          'msg-1',
          createMockMessage({
            discordMessageId: ['msg-1'],
            content: 'Voice message content',
            messageMetadata: {
              voiceTranscripts: ['Transcript text'],
            },
          }),
        ],
      ]);

      recoverEmptyDbContent(dbHistory, extendedMessageMap);

      expect(dbHistory[0].messageMetadata?.voiceTranscripts).toEqual(['Transcript text']);
    });

    it('should skip messages without Discord message ID', () => {
      const dbHistory = [
        createMockMessage({
          discordMessageId: [], // No ID
          content: '',
        }),
      ];
      const extendedMessageMap = new Map<string, ConversationMessage>();

      const recoveredCount = recoverEmptyDbContent(dbHistory, extendedMessageMap);

      expect(recoveredCount).toBe(0);
    });

    it('should skip when extended context also has empty content', () => {
      const dbHistory = [
        createMockMessage({
          discordMessageId: ['msg-1'],
          content: '',
        }),
      ];
      const extendedMessageMap = new Map<string, ConversationMessage>([
        [
          'msg-1',
          createMockMessage({
            discordMessageId: ['msg-1'],
            content: '', // Also empty
          }),
        ],
      ]);

      const recoveredCount = recoverEmptyDbContent(dbHistory, extendedMessageMap);

      expect(recoveredCount).toBe(0);
      expect(dbHistory[0].content).toBe('');
    });
  });

  describe('enrichDbMessagesWithExtendedMetadata', () => {
    it('should copy reactions from extended context to DB messages', () => {
      const reactions = [
        {
          emoji: '👍',
          isCustom: false,
          reactors: [{ personaId: 'discord:user-1', displayName: 'Alice' }],
        },
      ];
      const dbHistory = [
        createMockMessage({
          discordMessageId: ['msg-1'],
          content: 'Test',
        }),
      ];
      const extendedMessageMap = new Map<string, ConversationMessage>([
        [
          'msg-1',
          createMockMessage({
            discordMessageId: ['msg-1'],
            messageMetadata: { reactions },
          }),
        ],
      ]);

      const enrichedCount = enrichDbMessagesWithExtendedMetadata(dbHistory, extendedMessageMap);

      expect(enrichedCount).toBe(1);
      expect(dbHistory[0].messageMetadata?.reactions).toEqual(reactions);
    });

    it('should copy embeds from extended context if not present in DB', () => {
      const embedsXml = ['<embed>Test Embed</embed>'];
      const dbHistory = [
        createMockMessage({
          discordMessageId: ['msg-1'],
          content: 'Test',
        }),
      ];
      const extendedMessageMap = new Map<string, ConversationMessage>([
        [
          'msg-1',
          createMockMessage({
            discordMessageId: ['msg-1'],
            messageMetadata: { embedsXml },
          }),
        ],
      ]);

      enrichDbMessagesWithExtendedMetadata(dbHistory, extendedMessageMap);

      expect(dbHistory[0].messageMetadata?.embedsXml).toEqual(embedsXml);
    });

    it('should not overwrite existing embeds in DB message', () => {
      const dbHistory = [
        createMockMessage({
          discordMessageId: ['msg-1'],
          content: 'Test',
          messageMetadata: { embedsXml: ['<embed>DB Embed</embed>'] },
        }),
      ];
      const extendedMessageMap = new Map<string, ConversationMessage>([
        [
          'msg-1',
          createMockMessage({
            discordMessageId: ['msg-1'],
            messageMetadata: { embedsXml: ['<embed>Extended Embed</embed>'] },
          }),
        ],
      ]);

      enrichDbMessagesWithExtendedMetadata(dbHistory, extendedMessageMap);

      expect(dbHistory[0].messageMetadata?.embedsXml).toEqual(['<embed>DB Embed</embed>']);
    });

    it('should copy isForwarded flag from extended context to DB messages', () => {
      const dbHistory = [
        createMockMessage({
          discordMessageId: ['msg-1'],
          content: 'Test',
        }),
      ];
      const extendedMessageMap = new Map<string, ConversationMessage>([
        [
          'msg-1',
          {
            ...createMockMessage({
              discordMessageId: ['msg-1'],
            }),
            isForwarded: true,
          },
        ],
      ]);

      enrichDbMessagesWithExtendedMetadata(dbHistory, extendedMessageMap);

      expect(dbHistory[0].isForwarded).toBe(true);
    });

    it('should not overwrite isForwarded if already true on DB message', () => {
      const dbMsg = {
        ...createMockMessage({
          discordMessageId: ['msg-1'],
          content: 'Test',
        }),
        isForwarded: true,
      };
      const dbHistory = [dbMsg];
      const extendedMessageMap = new Map<string, ConversationMessage>([
        [
          'msg-1',
          createMockMessage({
            discordMessageId: ['msg-1'],
          }),
          // isForwarded not set (undefined/false)
        ],
      ]);

      enrichDbMessagesWithExtendedMetadata(dbHistory, extendedMessageMap);

      expect(dbHistory[0].isForwarded).toBe(true);
    });

    it('should handle messages not found in extended context', () => {
      const dbHistory = [
        createMockMessage({
          discordMessageId: ['msg-1'],
          content: 'Test',
        }),
      ];
      const extendedMessageMap = new Map<string, ConversationMessage>(); // Empty

      const enrichedCount = enrichDbMessagesWithExtendedMetadata(dbHistory, extendedMessageMap);

      expect(enrichedCount).toBe(0);
    });
  });

  describe('mergeWithHistory', () => {
    it('should deduplicate messages by Discord ID', () => {
      const extendedMessages = [
        createMockMessage({
          id: 'ext-1',
          discordMessageId: ['discord-1'],
          content: 'Extended content',
          createdAt: new Date('2024-01-01T12:00:00Z'),
        }),
        createMockMessage({
          id: 'ext-2',
          discordMessageId: ['discord-2'],
          content: 'Unique extended',
          createdAt: new Date('2024-01-01T12:01:00Z'),
        }),
      ];
      const dbHistory = [
        createMockMessage({
          id: 'db-1',
          discordMessageId: ['discord-1'], // Same as ext-1
          content: 'DB content',
          createdAt: new Date('2024-01-01T12:00:00Z'),
        }),
      ];

      const result = mergeWithHistory(extendedMessages, dbHistory);

      expect(result).toHaveLength(2);
      // DB message should be present (has priority)
      expect(result.some(m => m.content === 'DB content')).toBe(true);
      // Unique extended message should be present
      expect(result.some(m => m.content === 'Unique extended')).toBe(true);
      // Duplicate extended should NOT be present
      expect(result.some(m => m.content === 'Extended content')).toBe(false);
    });

    it('should sort by timestamp (oldest first)', () => {
      const extendedMessages = [
        createMockMessage({
          discordMessageId: ['discord-3'],
          content: 'Newest',
          createdAt: new Date('2024-01-01T12:05:00Z'),
        }),
      ];
      const dbHistory = [
        createMockMessage({
          discordMessageId: ['discord-1'],
          content: 'Oldest',
          createdAt: new Date('2024-01-01T12:00:00Z'),
        }),
        createMockMessage({
          discordMessageId: ['discord-2'],
          content: 'Middle',
          createdAt: new Date('2024-01-01T12:02:00Z'),
        }),
      ];

      const result = mergeWithHistory(extendedMessages, dbHistory);

      expect(result[0].content).toBe('Oldest');
      expect(result[1].content).toBe('Middle');
      expect(result[2].content).toBe('Newest');
    });

    it('should handle empty extended messages', () => {
      const dbHistory = [
        createMockMessage({
          discordMessageId: ['discord-1'],
          content: 'From DB',
        }),
      ];

      const result = mergeWithHistory([], dbHistory);

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('From DB');
    });

    it('should handle empty DB history', () => {
      const extendedMessages = [
        createMockMessage({
          discordMessageId: ['discord-1'],
          content: 'From extended',
        }),
      ];

      const result = mergeWithHistory(extendedMessages, []);

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('From extended');
    });

    it('should enrich DB messages with reactions from extended context', () => {
      const reactions = [
        {
          emoji: '👍',
          isCustom: false,
          reactors: [{ personaId: 'discord:user-1', displayName: 'Alice' }],
        },
      ];
      const extendedMessages = [
        createMockMessage({
          discordMessageId: ['discord-1'],
          content: 'Extended',
          messageMetadata: { reactions },
        }),
      ];
      const dbHistory = [
        createMockMessage({
          discordMessageId: ['discord-1'],
          content: 'DB content',
          // No reactions
        }),
      ];

      const result = mergeWithHistory(extendedMessages, dbHistory);

      // DB message should have been enriched with reactions
      expect(result[0].messageMetadata?.reactions).toEqual(reactions);
    });

    it('should handle string dates correctly', () => {
      const extendedMessages = [
        createMockMessage({
          discordMessageId: ['discord-2'],
          content: 'Second',
          createdAt: '2024-01-01T12:02:00Z' as unknown as Date,
        }),
      ];
      const dbHistory = [
        createMockMessage({
          discordMessageId: ['discord-1'],
          content: 'First',
          createdAt: '2024-01-01T12:01:00Z' as unknown as Date,
        }),
      ];

      const result = mergeWithHistory(extendedMessages, dbHistory);

      expect(result[0].content).toBe('First');
      expect(result[1].content).toBe('Second');
    });
  });
});
