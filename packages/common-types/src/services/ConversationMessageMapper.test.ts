import { describe, it, expect, vi } from 'vitest';
import {
  parseMessageMetadata,
  mapToConversationMessage,
  mapToConversationMessages,
  conversationHistorySelect,
  type ConversationHistoryQueryResult,
} from './ConversationMessageMapper.js';
import { MessageRole } from '../constants/index.js';

// Suppress logger warnings in tests
vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('ConversationMessageMapper', () => {
  describe('conversationHistorySelect', () => {
    it('includes all required fields', () => {
      expect(conversationHistorySelect.id).toBe(true);
      expect(conversationHistorySelect.role).toBe(true);
      expect(conversationHistorySelect.content).toBe(true);
      expect(conversationHistorySelect.tokenCount).toBe(true);
      expect(conversationHistorySelect.createdAt).toBe(true);
      expect(conversationHistorySelect.personaId).toBe(true);
      expect(conversationHistorySelect.discordMessageId).toBe(true);
      expect(conversationHistorySelect.messageMetadata).toBe(true);
    });

    it('includes persona relation with owner', () => {
      expect(conversationHistorySelect.persona).toBeDefined();
      expect(conversationHistorySelect.persona.select.name).toBe(true);
      expect(conversationHistorySelect.persona.select.preferredName).toBe(true);
      expect(conversationHistorySelect.persona.select.owner.select.username).toBe(true);
    });
  });

  describe('parseMessageMetadata', () => {
    it('returns undefined for null', () => {
      expect(parseMessageMetadata(null)).toBeUndefined();
    });

    it('returns undefined for undefined', () => {
      expect(parseMessageMetadata(undefined)).toBeUndefined();
    });

    it('parses valid metadata with referencedMessages', () => {
      const metadata = {
        referencedMessages: [
          {
            discordMessageId: 'msg-123',
            content: 'Hello',
            authorUsername: 'testuser',
            authorDisplayName: 'Test User',
            timestamp: '2024-01-15T10:00:00Z',
            locationContext: 'Server > #general',
          },
        ],
      };

      const result = parseMessageMetadata(metadata);

      expect(result).toBeDefined();
      expect(result?.referencedMessages).toHaveLength(1);
      expect(result?.referencedMessages?.[0].discordMessageId).toBe('msg-123');
    });

    it('parses valid metadata with attachmentDescriptions', () => {
      const metadata = {
        attachmentDescriptions: [
          {
            type: 'image' as const,
            description: 'A cat',
            originalUrl: 'https://example.com/cat.png',
            name: 'cat.png',
          },
        ],
      };

      const result = parseMessageMetadata(metadata);

      expect(result).toBeDefined();
      expect(result?.attachmentDescriptions).toHaveLength(1);
    });

    it('returns undefined for invalid metadata structure', () => {
      const invalidMetadata = {
        referencedMessages: 'not-an-array',
      };

      const result = parseMessageMetadata(invalidMetadata);

      expect(result).toBeUndefined();
    });
  });

  describe('mapToConversationMessage', () => {
    const createMockRecord = (
      overrides: Partial<ConversationHistoryQueryResult> = {}
    ): ConversationHistoryQueryResult => ({
      id: 'msg-uuid-123',
      role: MessageRole.User,
      content: 'Hello, world!',
      tokenCount: 5,
      createdAt: new Date('2024-01-15T10:30:00Z'),
      personaId: 'persona-uuid-456',
      discordMessageId: ['discord-123'],
      messageMetadata: null,
      persona: {
        name: 'Default Name',
        preferredName: 'Preferred Name',
        owner: {
          username: 'testuser',
        },
      },
      ...overrides,
    });

    it('maps all basic fields correctly', () => {
      const record = createMockRecord();

      const result = mapToConversationMessage(record);

      expect(result.id).toBe('msg-uuid-123');
      expect(result.role).toBe(MessageRole.User);
      expect(result.content).toBe('Hello, world!');
      expect(result.tokenCount).toBe(5);
      expect(result.createdAt).toEqual(new Date('2024-01-15T10:30:00Z'));
      expect(result.personaId).toBe('persona-uuid-456');
      expect(result.discordMessageId).toEqual(['discord-123']);
    });

    it('uses preferredName when available', () => {
      const record = createMockRecord({
        persona: {
          name: 'Default Name',
          preferredName: 'Preferred Name',
          owner: { username: 'testuser' },
        },
      });

      const result = mapToConversationMessage(record);

      expect(result.personaName).toBe('Preferred Name');
    });

    it('falls back to name when preferredName is null', () => {
      const record = createMockRecord({
        persona: {
          name: 'Default Name',
          preferredName: null,
          owner: { username: 'testuser' },
        },
      });

      const result = mapToConversationMessage(record);

      expect(result.personaName).toBe('Default Name');
    });

    it('includes discordUsername for disambiguation', () => {
      const record = createMockRecord({
        persona: {
          name: 'Name',
          preferredName: null,
          owner: { username: 'discord_user_123' },
        },
      });

      const result = mapToConversationMessage(record);

      expect(result.discordUsername).toBe('discord_user_123');
    });

    it('converts null tokenCount to undefined', () => {
      const record = createMockRecord({
        tokenCount: null,
      });

      const result = mapToConversationMessage(record);

      expect(result.tokenCount).toBeUndefined();
    });

    it('parses valid messageMetadata', () => {
      const record = createMockRecord({
        messageMetadata: {
          referencedMessages: [
            {
              discordMessageId: 'ref-msg-1',
              content: 'Referenced content',
              authorUsername: 'author',
              authorDisplayName: 'Author',
              timestamp: '2024-01-15T10:00:00Z',
              locationContext: 'Server > #general',
            },
          ],
        },
      });

      const result = mapToConversationMessage(record);

      expect(result.messageMetadata).toBeDefined();
      expect(result.messageMetadata?.referencedMessages).toHaveLength(1);
    });

    it('handles assistant role', () => {
      const record = createMockRecord({
        role: MessageRole.Assistant,
      });

      const result = mapToConversationMessage(record);

      expect(result.role).toBe(MessageRole.Assistant);
    });
  });

  describe('mapToConversationMessages', () => {
    it('maps empty array', () => {
      const result = mapToConversationMessages([]);

      expect(result).toEqual([]);
    });

    it('maps multiple records', () => {
      const records: ConversationHistoryQueryResult[] = [
        {
          id: 'msg-1',
          role: MessageRole.User,
          content: 'First message',
          tokenCount: 3,
          createdAt: new Date('2024-01-15T10:00:00Z'),
          personaId: 'persona-1',
          discordMessageId: ['d-1'],
          messageMetadata: null,
          persona: {
            name: 'User',
            preferredName: null,
            owner: { username: 'user1' },
          },
        },
        {
          id: 'msg-2',
          role: MessageRole.Assistant,
          content: 'Second message',
          tokenCount: 4,
          createdAt: new Date('2024-01-15T10:01:00Z'),
          personaId: 'persona-2',
          discordMessageId: ['d-2'],
          messageMetadata: null,
          persona: {
            name: 'Assistant',
            preferredName: 'AI',
            owner: { username: 'system' },
          },
        },
      ];

      const result = mapToConversationMessages(records);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('msg-1');
      expect(result[0].personaName).toBe('User');
      expect(result[1].id).toBe('msg-2');
      expect(result[1].personaName).toBe('AI');
    });

    it('preserves order of input records', () => {
      const records: ConversationHistoryQueryResult[] = [
        {
          id: 'first',
          role: MessageRole.User,
          content: 'First',
          tokenCount: 1,
          createdAt: new Date(),
          personaId: 'p1',
          discordMessageId: [],
          messageMetadata: null,
          persona: { name: 'N', preferredName: null, owner: { username: 'u' } },
        },
        {
          id: 'second',
          role: MessageRole.User,
          content: 'Second',
          tokenCount: 1,
          createdAt: new Date(),
          personaId: 'p2',
          discordMessageId: [],
          messageMetadata: null,
          persona: { name: 'N', preferredName: null, owner: { username: 'u' } },
        },
      ];

      const result = mapToConversationMessages(records);

      expect(result[0].id).toBe('first');
      expect(result[1].id).toBe('second');
    });
  });
});
