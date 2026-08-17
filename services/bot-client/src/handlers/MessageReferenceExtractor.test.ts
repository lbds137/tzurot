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

// Mock Redis
vi.mock('../redis.js', () => ({
  voiceTranscriptCache: {
    store: vi.fn(),
    get: vi.fn(),
  },
}));

// Mock the logger
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
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

describe('MessageReferenceExtractor (Orchestration)', () => {
  let extractor: MessageReferenceExtractor;

  beforeEach(() => {
    vi.clearAllMocks();

    // Use 0ms delay for faster tests
    extractor = new MessageReferenceExtractor({
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

      const { rawReferences: references } =
        await extractor.extractReferencesWithReplacement(message);

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

      const { rawReferences: references } =
        await extractor.extractReferencesWithReplacement(message);

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
      Object.defineProperty(message, 'channel', { value: mockChannel, writable: true });

      const { rawReferences: references } =
        await extractor.extractReferencesWithReplacement(message);

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
      Object.defineProperty(message, 'channel', { value: mockChannel, writable: true });

      const result = await extractor.extractReferencesWithReplacement(message);

      expect(result.rawReferences).toHaveLength(1);
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
      Object.defineProperty(message, 'channel', { value: mockChannel, writable: true });

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
        maxReferences: 10,
        embedProcessingDelayMs: 0,
      });

      const { rawReferences: references } =
        await limitedExtractor.extractReferencesWithReplacement(message);

      // Should limit to 10
      expect(references.length).toBeLessThanOrEqual(10);
    });
  });

  describe('Deduplication', () => {
    it('still emits a REPLY reference that is already in history', async () => {
      // A reply whose target is already in the chat log is not dropped — the AI
      // still needs to know WHICH message the user is responding to. It ships
      // as the full snapshot; ai-worker decides whether to stub it.
      const referencedMessage = createMockMessage({
        id: 'referenced-123',
        content: 'Already in history - preserved as stub',
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
      Object.defineProperty(message, 'channel', { value: mockChannel, writable: true });

      const dedupExtractor = new MessageReferenceExtractor({
        maxReferences: 10,
        embedProcessingDelayMs: 0,
        conversationHistoryMessageIds: ['referenced-123'], // Mark as already in history
      });

      const { rawReferences: references } =
        await dedupExtractor.extractReferencesWithReplacement(message);

      expect(references.length).toBe(1);
      expect(references[0].isDeduplicated).toBeUndefined();
      expect(references[0].content).toBe('Already in history - preserved as stub');
    });

    it('ships dedup-INVARIANT rawReferences + content (the channel-history read is vestigial for the envelope)', async () => {
      // `conversationHistoryMessageIds` IS bot-client's channel-history read output. It
      // drives the dedup decision, which routes a reference between the formatter's
      // deduped and regular branches. This proves that decision leaves the SHIPPED
      // `rawReferences` and the rewritten content byte-identical either way, because
      // both branches push the same full raw snapshot and increment the same
      // reference number. That
      // invariance is precisely why the worker can re-derive dedup from the raw
      // snapshots against its OWN history and bot-client's channel-history read is
      // vestigial for the thin envelope (the 2.5d history-eviction precondition).
      const sharedReferenced = createMockMessage({
        id: 'referenced-123',
        content: 'Already in history - preserved as stub',
        channel: createConfiguredChannel(),
      });
      // One shared referenced message → its createdAt is identical across both
      // extractions, so the raw snapshot's timestamp is comparable (the mock's
      // default createdAt is `new Date()`, which would otherwise drift per build).
      const buildTrigger = (): ReturnType<typeof createMockMessage> => {
        const message = createMockMessage({
          id: 'msg-123',
          reference: { messageId: 'referenced-123' } as any,
          fetchReference: vi.fn().mockResolvedValue(sharedReferenced),
        });
        const mockChannel = createConfiguredChannel({
          messages: { fetch: vi.fn().mockResolvedValue(message) },
        });
        Object.defineProperty(message, 'channel', { value: mockChannel, writable: true });
        return message;
      };
      const extract = (historyIds: string[]) =>
        new MessageReferenceExtractor({
          maxReferences: 10,
          embedProcessingDelayMs: 0,
          conversationHistoryMessageIds: historyIds,
        }).extractReferencesWithReplacement(buildTrigger());

      const notDeduped = await extract([]); // ref NOT in history → regular branch
      const deduped = await extract(['referenced-123']); // ref in history → deduped branch

      // The dedup decision now leaves no trace ANYWHERE on this side — not just
      // on the wire.
      expect(deduped.rawReferences).toEqual(notDeduped.rawReferences);
      expect(deduped.updatedContent).toEqual(notDeduped.updatedContent);
    });
  });
});
