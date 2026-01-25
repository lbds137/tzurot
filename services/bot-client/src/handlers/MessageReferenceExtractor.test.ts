/**
 * Tests for MessageReferenceExtractor (Orchestration Facade)
 *
 * This facade coordinates ReferenceCrawler and ReferenceFormatter.
 * Component-specific tests are in their respective test files:
 * - ReferenceCrawler.test.ts - BFS traversal, deduplication
 * - ReferenceFormatter.test.ts - Sorting, numbering, link replacement
 * - ReplyReferenceStrategy.test.ts - Reply extraction logic
 * - LinkReferenceStrategy.test.ts - Link parsing logic
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
import type { Client } from 'discord.js';

// Create shared mock for ConversationHistoryService methods
const mockGetMessageByDiscordId = vi.fn();

// Mock Redis
vi.mock('../redis.js', () => ({
  voiceTranscriptCache: {
    store: vi.fn(),
    get: vi.fn(),
  },
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

describe('MessageReferenceExtractor (Orchestration)', () => {
  let extractor: MessageReferenceExtractor;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMessageByDiscordId.mockReset();

    // Use 0ms delay for faster tests
    extractor = new MessageReferenceExtractor({
      prisma: {} as any,
      maxReferences: 10,
      embedProcessingDelayMs: 0,
    });
  });

  function createConfiguredChannel(overrides: any = {}) {
    return createMockTextChannel({
      isDMBased: vi.fn(() => false),
      isTextBased: vi.fn(() => true),
      ...overrides,
    });
  }

  describe('Orchestration', () => {
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

    it('should extract and format reply references', async () => {
      const referencedMessage = createMockMessage({
        id: 'referenced-123',
        content: 'Original message',
        author: createMockUser({ username: 'OriginalUser' }),
        createdAt: new Date('2025-11-02T12:00:00Z'),
        channel: createConfiguredChannel(),
      });

      const mockChannel = createConfiguredChannel({}) as any;

      const message = createMockMessage({
        id: 'msg-123',
        content: 'Reply message',
        channel: mockChannel,
        reference: { messageId: 'referenced-123' } as any,
        fetchReference: vi.fn().mockResolvedValue(referencedMessage),
      });

      mockChannel.messages = {
        fetch: vi.fn().mockResolvedValue(message),
      };

      const references = await extractor.extractReferences(message);

      expect(references).toHaveLength(1);
      expect(references[0].referenceNumber).toBe(1);
      expect(references[0].authorUsername).toBe('OriginalUser');
      expect(references[0].content).toBe('Original message');
    });

    it('should extract and format link references', async () => {
      const linkedMessage = createMockMessage({
        id: 'linked-456',
        content: 'Linked message content',
        author: createMockUser({ username: 'LinkedUser' }),
        channel: createConfiguredChannel(),
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

    it('should replace Discord links with [Reference N] placeholders', async () => {
      const linkedMessage = createMockMessage({
        id: 'linked-456',
        content: 'Linked content',
        author: createMockUser({ username: 'User' }),
        channel: createConfiguredChannel(),
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
        content: 'See https://discord.com/channels/123/456/789',
        reference: null,
        client,
      });

      const mockChannel = createConfiguredChannel({
        messages: {
          fetch: vi.fn().mockResolvedValue(message),
        },
      });
      message.channel = mockChannel;

      const result = await extractor.extractReferencesWithReplacement(message);

      expect(result.references).toHaveLength(1);
      expect(result.updatedContent).toBe('See [Reference 1]');
    });

    it('should respect maxReferences limit', async () => {
      const guild = createMockGuild({ id: '123' });
      const client = {
        guilds: {
          cache: createMockCollection([[guild.id, guild]]),
        },
      } as any as Client;

      // Create content with 15 message links
      const links = Array.from(
        { length: 15 },
        (_, i) => `https://discord.com/channels/123/456/${i}`
      ).join(' ');

      const message = createMockMessage({
        content: links,
        reference: null,
        client,
      });

      const mockChannel = createConfiguredChannel({
        messages: {
          fetch: vi.fn().mockResolvedValue(message),
        },
      });
      message.channel = mockChannel;

      // Mock each link to resolve to a message
      Array.from({ length: 15 }, (_, i) => {
        const channel = createConfiguredChannel({
          id: '456',
          messages: {
            fetch: vi.fn().mockResolvedValue(
              createMockMessage({
                id: String(i),
                content: `Message ${i}`,
                author: createMockUser({ username: `User${i}` }),
              })
            ),
          },
        });

        guild.channels = {
          cache: createMockCollection([['456', channel]]),
        } as any;
      });

      // Use extractor with limit of 10
      const limitedExtractor = new MessageReferenceExtractor({
        prisma: {} as any,
        maxReferences: 10,
        embedProcessingDelayMs: 0,
      });

      const references = await limitedExtractor.extractReferences(message);

      // Should limit to 10
      expect(references.length).toBeLessThanOrEqual(10);
    });
  });

  describe('Deduplication', () => {
    it('should exclude REPLY references when they are in conversation history', async () => {
      // With chronologically ordered chat_log, LLMs properly attend to recent messages.
      // No need to duplicate replies that are already in conversation history.
      const referencedMessage = createMockMessage({
        id: 'referenced-123',
        content: 'Already in history - will be skipped',
        channel: createConfiguredChannel(),
      });

      const message = createMockMessage({
        id: 'msg-123',
        reference: { messageId: 'referenced-123' } as any,
        fetchReference: vi.fn().mockResolvedValue(referencedMessage),
      });

      const mockChannel = createConfiguredChannel({
        messages: {
          fetch: vi.fn().mockResolvedValue(message),
        },
      });
      message.channel = mockChannel;

      const dedupExtractor = new MessageReferenceExtractor({
        prisma: {} as any,
        maxReferences: 10,
        embedProcessingDelayMs: 0,
        conversationHistoryMessageIds: ['referenced-123'], // Mark as already in history
      });

      const references = await dedupExtractor.extractReferences(message);

      // Replies in conversation history should be skipped (no duplication needed)
      expect(references.length).toBe(0);
    });
  });
});
