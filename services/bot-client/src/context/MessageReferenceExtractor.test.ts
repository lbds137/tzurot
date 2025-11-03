/**
 * Tests for MessageReferenceExtractor
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageReferenceExtractor } from './MessageReferenceExtractor.js';
import {
  createMockMessage,
  createMockTextChannel,
  createMockUser,
  createMockGuild,
  createMockCollection,
} from '../test/mocks/Discord.mock.js';
import type { Client, Message, TextChannel } from 'discord.js';

// Mock the logger
vi.mock('@tzurot/common-types', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('MessageReferenceExtractor', () => {
  let extractor: MessageReferenceExtractor;

  beforeEach(() => {
    vi.clearAllMocks();
    // Use 0ms delay for faster tests
    extractor = new MessageReferenceExtractor({
      maxReferences: 10,
      embedProcessingDelayMs: 0,
    });
  });

  /**
   * Helper to create a properly configured text channel with all required methods
   */
  function createConfiguredChannel(overrides: any = {}): TextChannel {
    return createMockTextChannel({
      isDMBased: vi.fn(() => false),
      isTextBased: vi.fn(() => true),
      ...overrides,
    });
  }

  describe('extractReferences', () => {
    it('should return empty array for message with no references', async () => {
      const mockChannel = createConfiguredChannel({
        messages: {
          fetch: vi.fn().mockResolvedValue(createMockMessage()),
        },
      });

      const message = createMockMessage({
        content: 'Hello world',
        reference: null,
        channel: mockChannel,
      });

      const references = await extractor.extractReferences(message);

      expect(references).toEqual([]);
    });

    it('should extract reply-to reference', async () => {
      // Create referenced message with properly configured channel
      const referencedChannel = createConfiguredChannel({});
      const referencedMessage = createMockMessage({
        id: 'referenced-123',
        content: 'Original message',
        author: createMockUser({ username: 'OriginalUser' }),
        createdAt: new Date('2025-11-02T12:00:00Z'),
        channel: referencedChannel,
      });

      // Create channel first
      const mockChannel = createConfiguredChannel({}) as any;

      // Create message with fetchReference mock
      const message = createMockMessage({
        id: 'msg-123',
        content: 'Reply message',
        channel: mockChannel,
        reference: { messageId: 'referenced-123' } as any,
        fetchReference: vi.fn().mockResolvedValue(referencedMessage),
      });

      // Configure channel to return this message when fetched
      mockChannel.messages = {
        fetch: vi.fn().mockResolvedValue(message),
      };

      const references = await extractor.extractReferences(message);

      expect(references).toHaveLength(1);
      expect(references[0].referenceNumber).toBe(1);
      expect(references[0].authorUsername).toBe('OriginalUser');
      expect(references[0].content).toBe('Original message');
    });

    it('should extract message link reference', async () => {
      const linkedChannel = createConfiguredChannel({});
      const linkedMessage = createMockMessage({
        id: 'linked-456',
        content: 'Linked message content',
        author: createMockUser({ username: 'LinkedUser' }),
        channel: linkedChannel,
      });

      const guild = createMockGuild({ id: '123' });
      const linkTargetChannel = createConfiguredChannel({
        id: '456',
        messages: {
          fetch: vi.fn().mockResolvedValue(linkedMessage),
        },
      });

      guild.channels = {
        cache: createMockCollection([[linkTargetChannel.id, linkTargetChannel]]),
      } as any;

      const client = {
        guilds: {
          cache: createMockCollection([[guild.id, guild]]),
        },
      } as any as Client;

      const message = createMockMessage({
        content: 'Check this https://discord.com/channels/123/456/789',
        reference: null,
        client,
      });

      const mockChannel = createConfiguredChannel({
        messages: {
          fetch: vi.fn().mockResolvedValue(message),
        },
      });
      message.channel = mockChannel;

      const references = await extractor.extractReferences(message);

      expect(references).toHaveLength(1);
      expect(references[0].referenceNumber).toBe(1);
      expect(references[0].authorUsername).toBe('LinkedUser');
    });

    it('should extract both reply and link references', async () => {
      const referencedChannel = createConfiguredChannel({});
      const referencedMessage = createMockMessage({
        id: 'referenced-123',
        content: 'Original',
        author: createMockUser({ username: 'User1' }),
        channel: referencedChannel,
      });

      const linkedChannel = createConfiguredChannel({});
      const linkedMessage = createMockMessage({
        id: 'linked-456',
        content: 'Linked',
        author: createMockUser({ username: 'User2' }),
        channel: linkedChannel,
      });

      const guild = createMockGuild({ id: '123' });
      const linkTargetChannel = createConfiguredChannel({
        id: '456',
        messages: {
          fetch: vi.fn().mockResolvedValue(linkedMessage),
        },
      });

      guild.channels = {
        cache: createMockCollection([[linkTargetChannel.id, linkTargetChannel]]),
      } as any;

      const client = {
        guilds: {
          cache: createMockCollection([[guild.id, guild]]),
        },
      } as any as Client;

      const message = createMockMessage({
        content: 'Check https://discord.com/channels/123/456/789',
        reference: { messageId: 'referenced-123' } as any,
        fetchReference: vi.fn().mockResolvedValue(referencedMessage),
        client,
      });

      const mockChannel = createConfiguredChannel({
        messages: {
          fetch: vi.fn().mockResolvedValue(message),
        },
      });
      message.channel = mockChannel;

      const references = await extractor.extractReferences(message);

      expect(references).toHaveLength(2);
      expect(references[0].referenceNumber).toBe(1);
      expect(references[0].authorUsername).toBe('User1');
      expect(references[1].referenceNumber).toBe(2);
      expect(references[1].authorUsername).toBe('User2');
    });

    it('should limit references to maxReferences', async () => {
      extractor = new MessageReferenceExtractor({
        maxReferences: 2,
        embedProcessingDelayMs: 0,
      });

      const referencedChannel = createConfiguredChannel({});
      const referencedMessage = createMockMessage({
        content: 'Referenced',
        author: createMockUser({ username: 'User1' }),
        channel: referencedChannel,
      });

      const linkedChannel = createConfiguredChannel({});
      const linkedMessages = [
        createMockMessage({
          id: 'link-1',
          content: 'Link 1',
          author: createMockUser({ username: 'User2' }),
          channel: linkedChannel,
        }),
        createMockMessage({
          id: 'link-2',
          content: 'Link 2',
          author: createMockUser({ username: 'User3' }),
          channel: linkedChannel,
        }),
        createMockMessage({
          id: 'link-3',
          content: 'Link 3',
          author: createMockUser({ username: 'User4' }),
          channel: linkedChannel,
        }),
      ];

      const guild = createMockGuild({ id: '123' });
      const linkTargetChannel = createConfiguredChannel({
        id: '456',
        messages: {
          fetch: vi
            .fn()
            .mockResolvedValueOnce(linkedMessages[0])
            .mockResolvedValueOnce(linkedMessages[1])
            .mockResolvedValueOnce(linkedMessages[2]),
        },
      });

      guild.channels = {
        cache: createMockCollection([[linkTargetChannel.id, linkTargetChannel]]),
      } as any;

      const client = {
        guilds: {
          cache: createMockCollection([[guild.id, guild]]),
        },
      } as any as Client;

      const message = createMockMessage({
        content:
          'https://discord.com/channels/123/456/1 https://discord.com/channels/123/456/2 https://discord.com/channels/123/456/3',
        reference: { messageId: 'referenced-123' } as any,
        fetchReference: vi.fn().mockResolvedValue(referencedMessage),
        client,
      });

      const mockChannel = createConfiguredChannel({
        messages: {
          fetch: vi.fn().mockResolvedValue(message),
        },
      });
      message.channel = mockChannel;

      const references = await extractor.extractReferences(message);

      expect(references).toHaveLength(2); // Limited to maxReferences
    });

    it('should skip inaccessible reply references silently', async () => {
      const message = createMockMessage({
        content: 'Reply to deleted message',
        reference: { messageId: 'deleted-123' } as any,
        fetchReference: vi.fn().mockRejectedValue(new Error('Unknown Message')),
      });

      const mockChannel = createConfiguredChannel({
        messages: {
          fetch: vi.fn().mockResolvedValue(message),
        },
      });
      message.channel = mockChannel;

      const references = await extractor.extractReferences(message);

      expect(references).toEqual([]);
    });

    it('should skip inaccessible guild references silently', async () => {
      const client = {
        guilds: {
          cache: createMockCollection(), // Empty - guild not accessible
        },
      } as any as Client;

      const message = createMockMessage({
        content: 'Link to inaccessible guild https://discord.com/channels/999/456/789',
        reference: null,
        client,
      });

      const mockChannel = createConfiguredChannel({
        messages: {
          fetch: vi.fn().mockResolvedValue(message),
        },
      });
      message.channel = mockChannel;

      const references = await extractor.extractReferences(message);

      expect(references).toEqual([]);
    });

    it('should skip inaccessible channel references silently', async () => {
      const guild = createMockGuild({ id: '123' });
      guild.channels = {
        cache: createMockCollection(), // Empty - channel not accessible
      } as any;

      const client = {
        guilds: {
          cache: createMockCollection([[guild.id, guild]]),
        },
      } as any as Client;

      const message = createMockMessage({
        content: 'Link to inaccessible channel https://discord.com/channels/123/999/789',
        reference: null,
        client,
      });

      const mockChannel = createConfiguredChannel({
        messages: {
          fetch: vi.fn().mockResolvedValue(message),
        },
      });
      message.channel = mockChannel;

      const references = await extractor.extractReferences(message);

      expect(references).toEqual([]);
    });

    it('should extract embeds from referenced messages', async () => {
      const referencedChannel = createConfiguredChannel({});
      const referencedMessage = createMockMessage({
        content: 'Message with embed',
        channel: referencedChannel,
        embeds: [
          {
            toJSON: () => ({
              title: 'Embed Title',
              description: 'Embed Description',
            }),
          },
        ] as any,
      });

      const message = createMockMessage({
        content: 'Reply',
        reference: { messageId: 'ref-123' } as any,
        fetchReference: vi.fn().mockResolvedValue(referencedMessage),
      });

      const mockChannel = createConfiguredChannel({
        messages: {
          fetch: vi.fn().mockResolvedValue(message),
        },
      });
      message.channel = mockChannel;

      const references = await extractor.extractReferences(message);

      expect(references).toHaveLength(1);
      expect(references[0].embeds).toContain('Embed Title');
      expect(references[0].embeds).toContain('Embed Description');
    });

    it('should include guild and channel metadata', async () => {
      const guild = createMockGuild({ id: '123', name: 'Test Server' });
      const channel = createConfiguredChannel({ id: '456', name: 'general', guild });

      const referencedMessage = createMockMessage({
        content: 'Message',
        guild,
        channel,
      });

      const message = createMockMessage({
        content: 'Reply',
        reference: { messageId: 'ref-123' } as any,
        fetchReference: vi.fn().mockResolvedValue(referencedMessage),
      });

      const mockChannel = createConfiguredChannel({
        messages: {
          fetch: vi.fn().mockResolvedValue(message),
        },
      });
      message.channel = mockChannel;

      const references = await extractor.extractReferences(message);

      expect(references).toHaveLength(1);
      expect(references[0].locationContext).toContain('Test Server');
      expect(references[0].locationContext).toContain('general');
    });

    it('should handle DM messages correctly', async () => {
      const referencedChannel = createConfiguredChannel({});
      const referencedMessage = createMockMessage({
        content: 'DM message',
        guild: null,
        channel: referencedChannel,
      });

      const message = createMockMessage({
        content: 'DM reply',
        guild: null,
        reference: { messageId: 'dm-ref' } as any,
        fetchReference: vi.fn().mockResolvedValue(referencedMessage),
      });

      const mockChannel = createConfiguredChannel({
        messages: {
          fetch: vi.fn().mockResolvedValue(message),
        },
      });
      message.channel = mockChannel;

      const references = await extractor.extractReferences(message);

      expect(references).toHaveLength(1);
      expect(references[0].locationContext).toContain('Direct Message');
    });
  });

  describe('Conversation History Deduplication', () => {
    // Deduplication uses EXACT Discord message ID matching only
    // Fuzzy timestamp matching was removed in PR #212 because it incorrectly
    // excluded messages from different channels with overlapping timestamps

    it('should exclude referenced message that is already in conversation history (exact match)', async () => {
      // Setup: Create extractor with conversation history message IDs
      const historyMessageIds = ['msg-in-history-123'];
      const extractor = new MessageReferenceExtractor({
        conversationHistoryMessageIds: historyMessageIds,
        embedProcessingDelayMs: 0,
      });

      const referencedChannel = createConfiguredChannel({});
      const referencedMessage = createMockMessage({
        id: 'msg-in-history-123',
        content: 'Already in history',
        author: createMockUser({ username: 'HistoryUser' }),
        channel: referencedChannel,
        createdAt: new Date('2025-11-02T10:00:00Z'),
      });

      // Create message that replies to msg-in-history-123
      const message = createMockMessage({
        content: 'Reply to history message',
        reference: { messageId: 'msg-in-history-123' } as any,
        fetchReference: vi.fn().mockResolvedValue(referencedMessage),
      });

      const mockChannel = createConfiguredChannel({
        messages: {
          fetch: vi.fn().mockResolvedValue(message),
        },
      });
      message.channel = mockChannel;

      // Extract references
      const references = await extractor.extractReferences(message);

      // Verify: Reference should be excluded (empty array)
      expect(references).toHaveLength(0);
    });

    it('should exclude message link reference that is in conversation history', async () => {
      // Setup: Create extractor with conversation history message IDs
      const historyMessageIds = ['msg-in-history-999'];
      const extractor = new MessageReferenceExtractor({
        conversationHistoryMessageIds: historyMessageIds,
        embedProcessingDelayMs: 0,
      });

      const linkedChannel = createConfiguredChannel({});
      const linkedMessage = createMockMessage({
        id: 'msg-in-history-999',
        content: 'Message already in history',
        author: createMockUser({ username: 'LinkedHistoryUser' }),
        channel: linkedChannel,
      });

      const guild = createMockGuild({ id: '123' });
      const linkTargetChannel = createConfiguredChannel({
        id: '456',
        messages: {
          fetch: vi.fn().mockResolvedValue(linkedMessage),
        },
      });

      guild.channels = {
        cache: createMockCollection([[linkTargetChannel.id, linkTargetChannel]]),
      } as any;

      const client = {
        guilds: {
          cache: createMockCollection([[guild.id, guild]]),
        },
      } as any as Client;

      const message = createMockMessage({
        content: 'Check this https://discord.com/channels/123/456/999',
        reference: null,
        client,
      });

      const mockChannel = createConfiguredChannel({
        messages: {
          fetch: vi.fn().mockResolvedValue(message),
        },
      });
      message.channel = mockChannel;

      const references = await extractor.extractReferences(message);

      // Verify: Link reference should be excluded
      expect(references).toHaveLength(0);
    });

    it('should handle mixed deduplication (some excluded, some included)', async () => {
      // Setup: Create extractor with message IDs for exact matching
      const historyMessageIds = ['msg-exact-match'];
      const extractor = new MessageReferenceExtractor({
        conversationHistoryMessageIds: historyMessageIds,
        embedProcessingDelayMs: 0,
      });

      // Reply reference: exact match (should be excluded)
      const referencedChannel = createConfiguredChannel({});
      const referencedMessage = createMockMessage({
        id: 'msg-exact-match',
        content: 'Exact match message',
        author: createMockUser({ username: 'ExactUser' }),
        channel: referencedChannel,
      });

      // Link: no match (should be included)
      const linkedChannel = createConfiguredChannel({});
      const linkedMessage = createMockMessage({
        id: 'msg-not-in-history',
        content: 'Not in history',
        author: createMockUser({ username: 'OtherUser' }),
        channel: linkedChannel,
      });

      const guild = createMockGuild({ id: '123' });
      const linkTargetChannel = createConfiguredChannel({
        id: '456',
        messages: {
          fetch: vi.fn().mockResolvedValue(linkedMessage),
        },
      });

      guild.channels = {
        cache: createMockCollection([[linkTargetChannel.id, linkTargetChannel]]),
      } as any;

      const client = {
        guilds: {
          cache: createMockCollection([[guild.id, guild]]),
        },
      } as any as Client;

      const message = createMockMessage({
        content: 'Reply with link https://discord.com/channels/123/456/999',
        reference: { messageId: 'msg-exact-match' } as any,
        fetchReference: vi.fn().mockResolvedValue(referencedMessage),
        client,
      });

      const mockChannel = createConfiguredChannel({
        messages: {
          fetch: vi.fn().mockResolvedValue(message),
        },
      });
      message.channel = mockChannel;

      const references = await extractor.extractReferences(message);

      // Verify: Only the link (not in history) should be included
      // Reply reference excluded due to exact match
      expect(references).toHaveLength(1);
      expect(references[0].content).toBe('Not in history');
      expect(references[0].authorUsername).toBe('OtherUser');
    });

    it('should deduplicate within references even when not in conversation history', async () => {
      // Setup: No conversation history provided
      const extractor = new MessageReferenceExtractor({
        embedProcessingDelayMs: 0,
      });

      // Reply and link both point to the same message
      const referencedChannel = createConfiguredChannel({});
      const referencedMessage = createMockMessage({
        id: 'same-message-123',
        content: 'Referenced twice',
        author: createMockUser({ username: 'SameUser' }),
        channel: referencedChannel,
      });

      const guild = createMockGuild({ id: '123' });
      const linkTargetChannel = createConfiguredChannel({
        id: '456',
        messages: {
          fetch: vi.fn().mockResolvedValue(referencedMessage),
        },
      });

      guild.channels = {
        cache: createMockCollection([[linkTargetChannel.id, linkTargetChannel]]),
      } as any;

      const client = {
        guilds: {
          cache: createMockCollection([[guild.id, guild]]),
        },
      } as any as Client;

      // Reply to a message AND link to the same message
      const message = createMockMessage({
        content: 'Check this https://discord.com/channels/123/456/same-message-123',
        reference: { messageId: 'same-message-123' } as any,
        fetchReference: vi.fn().mockResolvedValue(referencedMessage),
        client,
      });

      const mockChannel = createConfiguredChannel({
        messages: {
          fetch: vi.fn().mockResolvedValue(message),
        },
      });
      message.channel = mockChannel;

      const references = await extractor.extractReferences(message);

      // Verify: Only one reference (deduplicated)
      expect(references).toHaveLength(1);
      expect(references[0].content).toBe('Referenced twice');
      expect(references[0].referenceNumber).toBe(1);
    });
  });
});
