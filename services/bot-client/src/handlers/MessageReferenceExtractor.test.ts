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

// Create shared mock for ConversationHistoryService methods
const mockGetMessageByDiscordId = vi.fn();

// Mock Redis
vi.mock('../redis.js', () => ({
  getVoiceTranscript: vi.fn(),
}));

// Mock the logger and ConversationHistoryService
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
    ConversationHistoryService: class {
      getMessageByDiscordId = mockGetMessageByDiscordId;
    },
  };
});

import { getVoiceTranscript } from '../redis.js';
import { ConversationHistoryService } from '@tzurot/common-types';

describe('MessageReferenceExtractor', () => {
  let extractor: MessageReferenceExtractor;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the shared mock
    mockGetMessageByDiscordId.mockReset();
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

  describe('Forwarded messages', () => {
    it('should extract snapshots from forwarded messages', async () => {
      const { MessageReferenceType } = await import('discord.js');

      // Create a message snapshot (the original forwarded message)
      const mockSnapshot = {
        content: 'This is the original forwarded content',
        embeds: [],
        attachments: createMockCollection([]),
        createdTimestamp: new Date('2025-11-01T10:00:00Z').getTime(),
      };

      // Create the forwarded message (contains the snapshot)
      const forwardedChannel = createConfiguredChannel({});
      const forwardedMessage = createMockMessage({
        id: 'forwarded-123',
        content: '', // Forwarded messages typically have empty content
        author: createMockUser({ username: 'ForwarderUser' }),
        channel: forwardedChannel,
        reference: {
          type: MessageReferenceType.Forward,
          messageId: 'original-123',
        } as any,
        messageSnapshots: createMockCollection([['snapshot-1', mockSnapshot as any]]),
      });

      // Create the reply to the forwarded message
      const message = createMockMessage({
        id: 'reply-123',
        content: 'Reply to forward',
        reference: { messageId: 'forwarded-123' } as any,
        fetchReference: vi.fn().mockResolvedValue(forwardedMessage),
      });

      const mockChannel = createConfiguredChannel({
        messages: {
          fetch: vi.fn().mockResolvedValue(message),
        },
      });

      message.channel = mockChannel;

      const references = await extractor.extractReferences(message);

      // Should extract the snapshot, not the forwarded message wrapper
      expect(references).toHaveLength(1);
      expect(references[0].content).toBe('This is the original forwarded content');
      expect(references[0].isForwarded).toBe(true);
      expect(references[0].authorUsername).toBe('Unknown User');
      expect(references[0].authorDisplayName).toBe('Unknown User');
      expect(references[0].locationContext).toContain('(forwarded message)');
    });

    it('should extract multiple snapshots from a single forward', async () => {
      const { MessageReferenceType } = await import('discord.js');

      // Multiple snapshots in one forward
      const snapshot1 = {
        content: 'First forwarded message',
        embeds: [],
        attachments: createMockCollection([]),
        createdTimestamp: new Date('2025-11-01T10:00:00Z').getTime(),
      };

      const snapshot2 = {
        content: 'Second forwarded message',
        embeds: [],
        attachments: createMockCollection([]),
        createdTimestamp: new Date('2025-11-01T10:01:00Z').getTime(),
      };

      const forwardedChannel = createConfiguredChannel({});
      const forwardedMessage = createMockMessage({
        id: 'forwarded-multi-123',
        content: '',
        author: createMockUser({ username: 'ForwarderUser' }),
        channel: forwardedChannel,
        reference: {
          type: MessageReferenceType.Forward,
        } as any,
        messageSnapshots: createMockCollection([
          ['snapshot-1', snapshot1 as any],
          ['snapshot-2', snapshot2 as any],
        ]),
      });

      const message = createMockMessage({
        content: 'Reply',
        reference: { messageId: 'forwarded-multi-123' } as any,
        fetchReference: vi.fn().mockResolvedValue(forwardedMessage),
      });

      const mockChannel = createConfiguredChannel({
        messages: {
          fetch: vi.fn().mockResolvedValue(message),
        },
      });

      message.channel = mockChannel;

      const references = await extractor.extractReferences(message);

      // Should extract both snapshots
      expect(references).toHaveLength(2);
      expect(references[0].content).toBe('First forwarded message');
      expect(references[0].isForwarded).toBe(true);
      expect(references[0].referenceNumber).toBe(1);
      expect(references[1].content).toBe('Second forwarded message');
      expect(references[1].isForwarded).toBe(true);
      expect(references[1].referenceNumber).toBe(2);
    });

    it('should handle forwarded messages with attachments and embeds', async () => {
      const { MessageReferenceType } = await import('discord.js');

      const mockEmbed = {
        title: 'Forwarded Embed',
        description: 'Embed from original message',
      };

      const mockAttachment = {
        id: 'attachment-123',
        url: 'https://cdn.discord.com/attachments/123/456/image.png',
        contentType: 'image/png',
        name: 'image.png',
        size: 1024,
      };

      const snapshot = {
        content: 'Message with attachments',
        embeds: [mockEmbed],
        attachments: createMockCollection([['attachment-123', mockAttachment as any]]),
        createdTimestamp: new Date('2025-11-01T10:00:00Z').getTime(),
      };

      const forwardedChannel = createConfiguredChannel({});
      const forwardedMessage = createMockMessage({
        id: 'forwarded-with-media-123',
        content: '',
        author: createMockUser({ username: 'ForwarderUser' }),
        channel: forwardedChannel,
        reference: {
          type: MessageReferenceType.Forward,
        } as any,
        messageSnapshots: createMockCollection([['snapshot-1', snapshot as any]]),
      });

      const message = createMockMessage({
        content: 'Reply',
        reference: { messageId: 'forwarded-with-media-123' } as any,
        fetchReference: vi.fn().mockResolvedValue(forwardedMessage),
      });

      const mockChannel = createConfiguredChannel({
        messages: {
          fetch: vi.fn().mockResolvedValue(message),
        },
      });

      message.channel = mockChannel;

      const references = await extractor.extractReferences(message);

      expect(references).toHaveLength(1);
      expect(references[0].isForwarded).toBe(true);
      expect(references[0].content).toBe('Message with attachments');
      expect(references[0].embeds).toContain('Forwarded Embed');
      expect(references[0].attachments).toBeDefined();
      expect(references[0].attachments).toHaveLength(1);
      expect(references[0].attachments![0].url).toBe(
        'https://cdn.discord.com/attachments/123/456/image.png'
      );
    });

    it('should extract images from embeds in forwarded message snapshots', async () => {
      const { MessageReferenceType } = await import('discord.js');

      // Embed with both image and thumbnail
      const mockEmbed = {
        title: 'Embed with Images',
        description: 'This embed has images',
        image: { url: 'https://example.com/embed-image.png' },
        thumbnail: { url: 'https://example.com/embed-thumbnail.png' },
      };

      // Regular uploaded attachment
      const mockAttachment = {
        id: 'attachment-123',
        url: 'https://cdn.discord.com/attachments/123/456/uploaded.png',
        contentType: 'image/png',
        name: 'uploaded.png',
        size: 2048,
      };

      const snapshot = {
        content: 'Check out these images!',
        embeds: [mockEmbed as any],
        attachments: createMockCollection([['attachment-123', mockAttachment as any]]),
        createdTimestamp: new Date('2025-11-01T10:00:00Z').getTime(),
      };

      const forwardedChannel = createConfiguredChannel({});
      const forwardedMessage = createMockMessage({
        id: 'forwarded-with-embed-images-123',
        content: '',
        author: createMockUser({ username: 'ForwarderUser' }),
        channel: forwardedChannel,
        reference: {
          type: MessageReferenceType.Forward,
        } as any,
        messageSnapshots: createMockCollection([['snapshot-1', snapshot as any]]),
      });

      const message = createMockMessage({
        content: 'Reply',
        reference: { messageId: 'forwarded-with-embed-images-123' } as any,
        fetchReference: vi.fn().mockResolvedValue(forwardedMessage),
      });

      const mockChannel = createConfiguredChannel({
        messages: {
          fetch: vi.fn().mockResolvedValue(message),
        },
      });

      message.channel = mockChannel;

      const references = await extractor.extractReferences(message);

      expect(references).toHaveLength(1);
      expect(references[0].isForwarded).toBe(true);
      expect(references[0].content).toBe('Check out these images!');
      expect(references[0].attachments).toBeDefined();

      // Should have 3 attachments: 1 uploaded + 2 from embed (image + thumbnail)
      expect(references[0].attachments).toHaveLength(3);

      // Verify all three images are present
      const attachmentUrls = references[0].attachments!.map(a => a.url);
      expect(attachmentUrls).toContain('https://cdn.discord.com/attachments/123/456/uploaded.png');
      expect(attachmentUrls).toContain('https://example.com/embed-image.png');
      expect(attachmentUrls).toContain('https://example.com/embed-thumbnail.png');

      // Verify embed images have correct naming
      const embedImage = references[0].attachments!.find(
        a => a.url === 'https://example.com/embed-image.png'
      );
      expect(embedImage?.name).toBe('embed-image-1.png');

      const embedThumbnail = references[0].attachments!.find(
        a => a.url === 'https://example.com/embed-thumbnail.png'
      );
      expect(embedThumbnail?.name).toBe('embed-thumbnail-2.png');
    });

    it('should handle regular reply (not forwarded)', async () => {
      // Regular reply (no forward, no reference on the referenced message)
      const referencedChannel = createConfiguredChannel({});
      const referencedMessage = createMockMessage({
        id: 'regular-123',
        content: 'Regular message',
        author: createMockUser({
          id: 'user-123',
          username: 'RegularUser',
          displayName: 'Regular User',
        }),
        channel: referencedChannel,
        // Regular messages don't have a reference property
      });

      const message = createMockMessage({
        content: 'Reply',
        reference: { messageId: 'regular-123' } as any,
        fetchReference: vi.fn().mockResolvedValue(referencedMessage),
      });

      const mockChannel = createConfiguredChannel({
        messages: {
          fetch: vi.fn().mockResolvedValue(message),
        },
      });

      message.channel = mockChannel;

      const references = await extractor.extractReferences(message);

      // Should process as regular reference, not forwarded
      expect(references).toHaveLength(1);
      expect(references[0].content).toBe('Regular message');
      expect(references[0].isForwarded).toBeUndefined();
      expect(references[0].authorUsername).toBe('RegularUser');
      expect(references[0].authorDisplayName).toBe('Regular User');
    });
  });

  describe('Linked forwarded messages', () => {
    it('should extract snapshots from linked forwarded messages with images', async () => {
      const { MessageReferenceType } = await import('discord.js');

      // Use consistent IDs (all must be numeric Snowflakes)
      const GUILD_ID = '123456789012345678';
      const CHANNEL_ID = '987654321098765432';
      const FORWARDED_MESSAGE_ID = '112233445566778899';

      // Embed with image in the forwarded snapshot
      const mockEmbed = {
        title: 'Forwarded with Image',
        image: { url: 'https://example.com/forwarded-image.png' },
      };

      // Snapshot with both regular attachment and embed image
      const mockAttachment = {
        id: 'attachment-456',
        url: 'https://cdn.discord.com/attachments/789/012/file.png',
        contentType: 'image/png',
        name: 'file.png',
        size: 3072,
      };

      const snapshot = {
        content: 'Original forwarded message with images',
        embeds: [mockEmbed as any],
        attachments: createMockCollection([['attachment-456', mockAttachment as any]]),
        createdTimestamp: new Date('2025-11-01T10:00:00Z').getTime(),
      };

      // The forwarded message (what the link points to)
      const forwardedMessage = createMockMessage({
        id: FORWARDED_MESSAGE_ID,
        content: '', // Forward wrappers are empty
        author: createMockUser({ username: 'ForwarderUser' }),
        reference: {
          type: MessageReferenceType.Forward,
        } as any,
        messageSnapshots: createMockCollection([['snapshot-1', snapshot as any]]),
      });

      // Current message with link to the forwarded message
      const CURRENT_MESSAGE_ID = 'current-123';
      const message = createMockMessage({
        id: CURRENT_MESSAGE_ID,
        content: `Check this out: https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}/${FORWARDED_MESSAGE_ID}`,
        author: createMockUser({ username: 'CurrentUser' }),
      });

      // Mock channel that can fetch both the current message and the forwarded message
      const mockChannel = createConfiguredChannel({
        id: CHANNEL_ID,
        messages: {
          fetch: vi.fn().mockImplementation(async (id: string) => {
            if (id === FORWARDED_MESSAGE_ID) {
              return forwardedMessage;
            }
            if (id === CURRENT_MESSAGE_ID) {
              return message;
            }
            return null;
          }),
        },
      });

      // Ensure the forwarded message knows its channel
      forwardedMessage.channel = mockChannel;

      // Mock guild structure
      const mockGuild = {
        id: GUILD_ID,
        channels: {
          cache: new Map([[CHANNEL_ID, mockChannel]]),
          fetch: vi.fn().mockResolvedValue(mockChannel),
        },
      };

      // Set up the client structure on the current message
      message.channel = mockChannel;
      message.guild = mockGuild as any;
      message.client = {
        guilds: {
          cache: new Map([[GUILD_ID, mockGuild]]),
          fetch: vi.fn().mockResolvedValue(mockGuild),
        },
      } as any;

      const references = await extractor.extractReferences(message);

      // Should extract the snapshot with all images
      expect(references).toHaveLength(1);
      expect(references[0].content).toBe('Original forwarded message with images');
      expect(references[0].isForwarded).toBe(true);
      expect(references[0].attachments).toBeDefined();

      // Should have 2 images: regular attachment + embed image
      expect(references[0].attachments).toHaveLength(2);

      const attachmentUrls = references[0].attachments!.map(a => a.url);
      expect(attachmentUrls).toContain('https://cdn.discord.com/attachments/789/012/file.png');
      expect(attachmentUrls).toContain('https://example.com/forwarded-image.png');

      // Verify the mock was called with the correct ID
      expect(mockChannel.messages.fetch).toHaveBeenCalledWith(FORWARDED_MESSAGE_ID);
    });
  });

  describe('Voice Message Transcript Retrieval', () => {
    it('should include voice transcript from Redis cache when available', async () => {
      const voiceAttachmentUrl = 'https://cdn.discord.com/attachments/123/456/voice.ogg';
      const transcript = 'This is the transcribed voice message';

      // Mock Redis cache hit
      (getVoiceTranscript as ReturnType<typeof vi.fn>).mockResolvedValue(transcript);

      const referencedChannel = createConfiguredChannel({});
      const referencedMessage = createMockMessage({
        id: 'voice-msg-123',
        content: '', // Voice messages typically have no text content
        author: createMockUser({ username: 'VoiceUser' }),
        createdAt: new Date('2025-11-14T12:00:00Z'),
        channel: referencedChannel,
        attachments: createMockCollection([
          [
            'attachment-1',
            {
              id: 'attachment-1',
              url: voiceAttachmentUrl,
              contentType: 'audio/ogg',
              name: 'voice-message.ogg',
              size: 50000,
              duration: 5.2, // Voice message indicator
              waveform: 'base64data',
            },
          ],
        ]),
      });

      const mockChannel = createConfiguredChannel({}) as any;
      const message = createMockMessage({
        id: 'msg-123',
        content: 'Reply to voice',
        channel: mockChannel,
        reference: { messageId: 'voice-msg-123' } as any,
        fetchReference: vi.fn().mockResolvedValue(referencedMessage),
      });

      mockChannel.messages = {
        fetch: vi.fn().mockResolvedValue(message),
      };

      const references = await extractor.extractReferences(message);

      expect(references).toHaveLength(1);
      expect(references[0].content).toBe(`[Voice transcript]: ${transcript}`);
      expect(getVoiceTranscript).toHaveBeenCalledWith(voiceAttachmentUrl);
    });

    it('should include voice transcript from database when Redis cache expired', async () => {
      const voiceAttachmentUrl = 'https://cdn.discord.com/attachments/123/456/voice.ogg';
      const dbTranscript = 'This is the database-stored transcript';

      // Mock Redis cache miss
      (getVoiceTranscript as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      // Mock database hit using shared mock
      mockGetMessageByDiscordId.mockResolvedValue({
        id: 'db-id-123',
        content: dbTranscript,
        role: 'user',
      });

      const referencedChannel = createConfiguredChannel({});
      const referencedMessage = createMockMessage({
        id: 'voice-msg-456',
        content: '',
        author: createMockUser({ username: 'VoiceUser' }),
        createdAt: new Date('2025-11-14T12:00:00Z'),
        channel: referencedChannel,
        attachments: createMockCollection([
          [
            'attachment-1',
            {
              id: 'attachment-1',
              url: voiceAttachmentUrl,
              contentType: 'audio/ogg',
              name: 'voice-message.ogg',
              size: 50000,
              duration: 10.5,
              waveform: 'base64data',
            },
          ],
        ]),
      });

      const mockChannel = createConfiguredChannel({}) as any;
      const message = createMockMessage({
        id: 'msg-456',
        content: 'Reply to old voice',
        channel: mockChannel,
        reference: { messageId: 'voice-msg-456' } as any,
        fetchReference: vi.fn().mockResolvedValue(referencedMessage),
      });

      mockChannel.messages = {
        fetch: vi.fn().mockResolvedValue(message),
      };

      const references = await extractor.extractReferences(message);

      expect(references).toHaveLength(1);
      expect(references[0].content).toBe(`[Voice transcript]: ${dbTranscript}`);
      expect(getVoiceTranscript).toHaveBeenCalledWith(voiceAttachmentUrl);
      expect(mockGetMessageByDiscordId).toHaveBeenCalledWith('voice-msg-456');
    });

    it('should handle voice message with no available transcript', async () => {
      const voiceAttachmentUrl = 'https://cdn.discord.com/attachments/123/456/voice.ogg';

      // Mock both Redis and database miss
      (getVoiceTranscript as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      mockGetMessageByDiscordId.mockResolvedValue(null);

      const referencedChannel = createConfiguredChannel({});
      const referencedMessage = createMockMessage({
        id: 'voice-msg-789',
        content: '',
        author: createMockUser({ username: 'VoiceUser' }),
        createdAt: new Date('2025-11-14T12:00:00Z'),
        channel: referencedChannel,
        attachments: createMockCollection([
          [
            'attachment-1',
            {
              id: 'attachment-1',
              url: voiceAttachmentUrl,
              contentType: 'audio/ogg',
              name: 'voice-message.ogg',
              size: 50000,
              duration: 3.0,
              waveform: 'base64data',
            },
          ],
        ]),
      });

      const mockChannel = createConfiguredChannel({}) as any;
      const message = createMockMessage({
        id: 'msg-789',
        content: 'Reply to untranscribed voice',
        channel: mockChannel,
        reference: { messageId: 'voice-msg-789' } as any,
        fetchReference: vi.fn().mockResolvedValue(referencedMessage),
      });

      mockChannel.messages = {
        fetch: vi.fn().mockResolvedValue(message),
      };

      const references = await extractor.extractReferences(message);

      expect(references).toHaveLength(1);
      // Should only have the placeholder, no transcript
      expect(references[0].content).toBe('');
      expect(references[0].attachments).toBeDefined();
      expect(references[0].attachments?.[0].isVoiceMessage).toBe(true);
    });

    it('should combine text content with voice transcript', async () => {
      const voiceAttachmentUrl = 'https://cdn.discord.com/attachments/123/456/voice.ogg';
      const transcript = 'Voice message transcript';

      (getVoiceTranscript as ReturnType<typeof vi.fn>).mockResolvedValue(transcript);

      const referencedChannel = createConfiguredChannel({});
      const referencedMessage = createMockMessage({
        id: 'voice-msg-combo',
        content: 'Check this out', // Has text AND voice
        author: createMockUser({ username: 'VoiceUser' }),
        createdAt: new Date('2025-11-14T12:00:00Z'),
        channel: referencedChannel,
        attachments: createMockCollection([
          [
            'attachment-1',
            {
              id: 'attachment-1',
              url: voiceAttachmentUrl,
              contentType: 'audio/ogg',
              name: 'voice-message.ogg',
              size: 50000,
              duration: 2.0,
              waveform: 'base64data',
            },
          ],
        ]),
      });

      const mockChannel = createConfiguredChannel({}) as any;
      const message = createMockMessage({
        id: 'msg-combo',
        content: 'Reply',
        channel: mockChannel,
        reference: { messageId: 'voice-msg-combo' } as any,
        fetchReference: vi.fn().mockResolvedValue(referencedMessage),
      });

      mockChannel.messages = {
        fetch: vi.fn().mockResolvedValue(message),
      };

      const references = await extractor.extractReferences(message);

      expect(references).toHaveLength(1);
      expect(references[0].content).toBe(`Check this out\n\n[Voice transcript]: ${transcript}`);
    });

    it('should handle multiple voice attachments', async () => {
      const voiceUrl1 = 'https://cdn.discord.com/attachments/123/456/voice1.ogg';
      const voiceUrl2 = 'https://cdn.discord.com/attachments/123/456/voice2.ogg';
      const transcript1 = 'First voice message';
      const transcript2 = 'Second voice message';

      (getVoiceTranscript as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(transcript1)
        .mockResolvedValueOnce(transcript2);

      const referencedChannel = createConfiguredChannel({});
      const referencedMessage = createMockMessage({
        id: 'voice-msg-multi',
        content: '',
        author: createMockUser({ username: 'VoiceUser' }),
        createdAt: new Date('2025-11-14T12:00:00Z'),
        channel: referencedChannel,
        attachments: createMockCollection([
          [
            'attachment-1',
            {
              id: 'attachment-1',
              url: voiceUrl1,
              contentType: 'audio/ogg',
              name: 'voice1.ogg',
              size: 50000,
              duration: 2.0,
            },
          ],
          [
            'attachment-2',
            {
              id: 'attachment-2',
              url: voiceUrl2,
              contentType: 'audio/ogg',
              name: 'voice2.ogg',
              size: 60000,
              duration: 3.0,
            },
          ],
        ]),
      });

      const mockChannel = createConfiguredChannel({}) as any;
      const message = createMockMessage({
        id: 'msg-multi',
        content: 'Reply to multiple',
        channel: mockChannel,
        reference: { messageId: 'voice-msg-multi' } as any,
        fetchReference: vi.fn().mockResolvedValue(referencedMessage),
      });

      mockChannel.messages = {
        fetch: vi.fn().mockResolvedValue(message),
      };

      const references = await extractor.extractReferences(message);

      expect(references).toHaveLength(1);
      expect(references[0].content).toBe(
        `[Voice transcript]: ${transcript1}\n\n${transcript2}`
      );
    });

    it('should not retrieve transcripts for non-voice audio attachments', async () => {
      const audioUrl = 'https://cdn.discord.com/attachments/123/456/music.mp3';

      const referencedChannel = createConfiguredChannel({});
      const referencedMessage = createMockMessage({
        id: 'audio-msg',
        content: 'Music file',
        author: createMockUser({ username: 'MusicUser' }),
        createdAt: new Date('2025-11-14T12:00:00Z'),
        channel: referencedChannel,
        attachments: createMockCollection([
          [
            'attachment-1',
            {
              id: 'attachment-1',
              url: audioUrl,
              contentType: 'audio/mpeg',
              name: 'music.mp3',
              size: 5000000,
              duration: null, // Not a voice message
            },
          ],
        ]),
      });

      const mockChannel = createConfiguredChannel({}) as any;
      const message = createMockMessage({
        id: 'msg-music',
        content: 'Reply to music',
        channel: mockChannel,
        reference: { messageId: 'audio-msg' } as any,
        fetchReference: vi.fn().mockResolvedValue(referencedMessage),
      });

      mockChannel.messages = {
        fetch: vi.fn().mockResolvedValue(message),
      };

      const references = await extractor.extractReferences(message);

      expect(references).toHaveLength(1);
      expect(references[0].content).toBe('Music file');
      // Should not have called getVoiceTranscript for non-voice audio
      expect(getVoiceTranscript).not.toHaveBeenCalled();
    });
  });
});
