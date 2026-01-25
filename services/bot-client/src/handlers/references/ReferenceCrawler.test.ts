/**
 * Tests for ReferenceCrawler
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReferenceCrawler } from './ReferenceCrawler.js';
import { ReferenceType } from './types.js';
import { createMockMessage } from '../../test/mocks/Discord.mock.js';
import type { IReferenceStrategy } from './strategies/IReferenceStrategy.js';
import type { LinkExtractor } from './LinkExtractor.js';

describe('ReferenceCrawler', () => {
  let mockLinkExtractor: LinkExtractor;
  let mockStrategy: IReferenceStrategy;

  beforeEach(() => {
    // Mock LinkExtractor
    mockLinkExtractor = {
      fetchMessageFromLink: vi.fn(),
    } as any;

    // Mock Strategy
    mockStrategy = {
      extract: vi.fn().mockResolvedValue([]),
    };
  });

  describe('Basic Extraction', () => {
    it('should return empty result for message with no references', async () => {
      const crawler = new ReferenceCrawler({
        maxReferences: 10,
        strategies: [mockStrategy],
        linkExtractor: mockLinkExtractor,
      });

      const message = createMockMessage({
        content: 'Hello world',
      });

      const result = await crawler.crawl(message);

      expect(result.messages.size).toBe(0);
      expect(result.maxDepth).toBe(0);
    });

    it('should extract single reply reference', async () => {
      const referencedMessage = createMockMessage({
        id: 'ref-1',
        content: 'Original',
        createdAt: new Date('2025-01-01T12:00:00Z'),
      });

      const message = createMockMessage({
        id: 'msg-1',
        reference: { messageId: 'ref-1' } as any,
        fetchReference: vi.fn().mockResolvedValue(referencedMessage),
      });

      vi.mocked(mockStrategy.extract).mockResolvedValue([
        {
          messageId: 'ref-1',
          channelId: 'channel-1',
          guildId: 'guild-1',
          type: ReferenceType.REPLY,
        },
      ]);

      const crawler = new ReferenceCrawler({
        maxReferences: 10,
        strategies: [mockStrategy],
        linkExtractor: mockLinkExtractor,
      });

      const result = await crawler.crawl(message);

      expect(result.messages.size).toBe(1);
      expect(result.messages.has('ref-1')).toBe(true);
      expect(result.maxDepth).toBe(1);

      const crawled = result.messages.get('ref-1');
      expect(crawled?.metadata.depth).toBe(1);
      expect(crawled?.metadata.messageId).toBe('ref-1');
    });

    it('should extract single link reference', async () => {
      const referencedMessage = createMockMessage({
        id: 'ref-1',
        content: 'Linked',
        createdAt: new Date('2025-01-01T12:00:00Z'),
      });

      const message = createMockMessage({
        id: 'msg-1',
        content: 'https://discord.com/channels/123/456/789',
      });

      vi.mocked(mockStrategy.extract).mockResolvedValue([
        {
          messageId: 'ref-1',
          channelId: '456',
          guildId: '123',
          type: ReferenceType.LINK,
          discordUrl: 'https://discord.com/channels/123/456/789',
        },
      ]);

      vi.mocked(mockLinkExtractor.fetchMessageFromLink).mockResolvedValue(referencedMessage);

      const crawler = new ReferenceCrawler({
        maxReferences: 10,
        strategies: [mockStrategy],
        linkExtractor: mockLinkExtractor,
      });

      const result = await crawler.crawl(message);

      expect(result.messages.size).toBe(1);
      expect(result.messages.has('ref-1')).toBe(true);
      expect(result.maxDepth).toBe(1);

      const crawled = result.messages.get('ref-1');
      expect(crawled?.metadata.discordUrl).toBe('https://discord.com/channels/123/456/789');
    });
  });

  describe('BFS Traversal', () => {
    it('should traverse 2 levels deep via reply chain', async () => {
      // Level 2: Oldest reference
      const level2Message = createMockMessage({
        id: 'level-2',
        content: 'Level 2',
        createdAt: new Date('2025-01-01T12:00:00Z'),
        reference: null,
      });

      // Level 1: References level 2
      const level1Message = createMockMessage({
        id: 'level-1',
        content: 'Level 1',
        createdAt: new Date('2025-01-01T12:01:00Z'),
        reference: { messageId: 'level-2' } as any,
        fetchReference: vi.fn().mockResolvedValue(level2Message),
      });

      // Level 0: Root message references level 1
      const rootMessage = createMockMessage({
        id: 'root',
        content: 'Root',
        createdAt: new Date('2025-01-01T12:02:00Z'),
        reference: { messageId: 'level-1' } as any,
        fetchReference: vi.fn().mockResolvedValue(level1Message),
      });

      // Mock strategy to return references for each level
      vi.mocked(mockStrategy.extract).mockImplementation(async msg => {
        if (msg.id === 'root') {
          return [
            {
              messageId: 'level-1',
              channelId: 'channel-1',
              guildId: 'guild-1',
              type: ReferenceType.REPLY,
            },
          ];
        }
        if (msg.id === 'level-1') {
          return [
            {
              messageId: 'level-2',
              channelId: 'channel-1',
              guildId: 'guild-1',
              type: ReferenceType.REPLY,
            },
          ];
        }
        return [];
      });

      const crawler = new ReferenceCrawler({
        maxReferences: 10,
        strategies: [mockStrategy],
        linkExtractor: mockLinkExtractor,
      });

      const result = await crawler.crawl(rootMessage);

      expect(result.messages.size).toBe(2);
      expect(result.maxDepth).toBe(2);

      const level1 = result.messages.get('level-1');
      expect(level1?.metadata.depth).toBe(1);

      const level2 = result.messages.get('level-2');
      expect(level2?.metadata.depth).toBe(2);
    });

    it('should prioritize breadth over depth (BFS)', async () => {
      // Create a tree structure:
      //        root
      //       /    \
      //    ref-1  ref-2  (depth 1)
      //      |
      //    ref-3        (depth 2)

      const ref3 = createMockMessage({
        id: 'ref-3',
        content: 'Ref 3',
        createdAt: new Date('2025-01-01T12:00:00Z'),
        reference: null,
      });

      const ref1 = createMockMessage({
        id: 'ref-1',
        content: 'Ref 1',
        createdAt: new Date('2025-01-01T12:01:00Z'),
        reference: { messageId: 'ref-3' } as any,
        fetchReference: vi.fn().mockResolvedValue(ref3),
      });

      const ref2 = createMockMessage({
        id: 'ref-2',
        content: 'Ref 2',
        createdAt: new Date('2025-01-01T12:02:00Z'),
        reference: null,
      });

      const root = createMockMessage({
        id: 'root',
        content:
          'Root with https://discord.com/channels/1/2/ref-1 and https://discord.com/channels/1/2/ref-2',
        createdAt: new Date('2025-01-01T12:03:00Z'),
      });

      vi.mocked(mockStrategy.extract).mockImplementation(async msg => {
        if (msg.id === 'root') {
          return [
            {
              messageId: 'ref-1',
              channelId: '2',
              guildId: '1',
              type: ReferenceType.LINK,
              discordUrl: 'https://discord.com/channels/1/2/ref-1',
            },
            {
              messageId: 'ref-2',
              channelId: '2',
              guildId: '1',
              type: ReferenceType.LINK,
              discordUrl: 'https://discord.com/channels/1/2/ref-2',
            },
          ];
        }
        if (msg.id === 'ref-1') {
          return [
            {
              messageId: 'ref-3',
              channelId: '2',
              guildId: '1',
              type: ReferenceType.REPLY,
            },
          ];
        }
        return [];
      });

      vi.mocked(mockLinkExtractor.fetchMessageFromLink).mockImplementation(async link => {
        if (link.messageId === 'ref-1') return ref1;
        if (link.messageId === 'ref-2') return ref2;
        if (link.messageId === 'ref-3') return ref3;
        return null;
      });

      const crawler = new ReferenceCrawler({
        maxReferences: 10,
        strategies: [mockStrategy],
        linkExtractor: mockLinkExtractor,
      });

      const result = await crawler.crawl(root);

      // Should have collected all 3 references
      expect(result.messages.size).toBe(3);
      expect(result.maxDepth).toBe(2);

      // Verify depth assignments
      expect(result.messages.get('ref-1')?.metadata.depth).toBe(1);
      expect(result.messages.get('ref-2')?.metadata.depth).toBe(1);
      expect(result.messages.get('ref-3')?.metadata.depth).toBe(2);
    });
  });

  describe('Limit Enforcement', () => {
    it('should respect maxReferences limit', async () => {
      const root = createMockMessage({ id: 'root' });

      // Create 15 references but limit to 10
      const references = Array.from({ length: 15 }, (_, i) => ({
        messageId: `ref-${i}`,
        channelId: 'channel-1',
        guildId: 'guild-1',
        type: ReferenceType.LINK,
      }));

      vi.mocked(mockStrategy.extract).mockResolvedValue(references);

      // Mock fetchMessageFromLink to return messages
      vi.mocked(mockLinkExtractor.fetchMessageFromLink).mockImplementation(async link => {
        return createMockMessage({
          id: link.messageId,
          createdAt: new Date(`2025-01-01T12:${link.messageId.split('-')[1]}:00Z`),
        });
      });

      const crawler = new ReferenceCrawler({
        maxReferences: 10,
        strategies: [mockStrategy],
        linkExtractor: mockLinkExtractor,
      });

      const result = await crawler.crawl(root);

      expect(result.messages.size).toBe(10);
    });
  });

  describe('Deduplication', () => {
    it('should skip LINK references already in conversation history (exact match)', async () => {
      // LINK references can be deduplicated - they're incidental mentions in message text
      const referencedMessage = createMockMessage({
        id: 'ref-1',
        content: 'Already in history',
      });

      const message = createMockMessage({
        id: 'msg-1',
        content: 'Check this: https://discord.com/channels/1/2/ref-1',
      });

      vi.mocked(mockStrategy.extract).mockResolvedValue([
        {
          messageId: 'ref-1',
          channelId: 'channel-1',
          guildId: 'guild-1',
          type: ReferenceType.LINK, // Link references ARE deduplicated
          discordUrl: 'https://discord.com/channels/1/2/ref-1',
        },
      ]);

      vi.mocked(mockLinkExtractor.fetchMessageFromLink).mockResolvedValue(referencedMessage);

      const crawler = new ReferenceCrawler({
        maxReferences: 10,
        strategies: [mockStrategy],
        linkExtractor: mockLinkExtractor,
        conversationHistoryMessageIds: new Set(['ref-1']), // Mark as already in history
      });

      const result = await crawler.crawl(message);

      expect(result.messages.size).toBe(0); // Link references should be excluded if in history
    });

    it('should skip REPLY references when they are in conversation history', async () => {
      // With chronologically ordered chat_log, LLMs properly attend to recent messages.
      // No need to duplicate replies that are already in conversation history.
      const referencedMessage = createMockMessage({
        id: 'ref-1',
        content: 'Already in history - will be skipped',
      });

      const message = createMockMessage({
        id: 'msg-1',
        reference: { messageId: 'ref-1' } as any,
        fetchReference: vi.fn().mockResolvedValue(referencedMessage),
      });

      vi.mocked(mockStrategy.extract).mockResolvedValue([
        {
          messageId: 'ref-1',
          channelId: 'channel-1',
          guildId: 'guild-1',
          type: ReferenceType.REPLY,
        },
      ]);

      const crawler = new ReferenceCrawler({
        maxReferences: 10,
        strategies: [mockStrategy],
        linkExtractor: mockLinkExtractor,
        conversationHistoryMessageIds: new Set(['ref-1']), // Mark as already in history
      });

      const result = await crawler.crawl(message);

      // Replies in conversation history should be skipped (no duplication needed)
      expect(result.messages.size).toBe(0);
    });

    it('should skip duplicate references within same crawl', async () => {
      // Message with same reference mentioned twice
      const referencedMessage = createMockMessage({
        id: 'ref-1',
        content: 'Referenced',
      });

      const message = createMockMessage({
        id: 'msg-1',
        content:
          'https://discord.com/channels/1/2/ref-1 and also https://discord.com/channels/1/2/ref-1',
      });

      vi.mocked(mockStrategy.extract).mockResolvedValue([
        {
          messageId: 'ref-1',
          channelId: '2',
          guildId: '1',
          type: ReferenceType.LINK,
          discordUrl: 'https://discord.com/channels/1/2/ref-1',
        },
        {
          messageId: 'ref-1', // Same reference again
          channelId: '2',
          guildId: '1',
          type: ReferenceType.LINK,
          discordUrl: 'https://discord.com/channels/1/2/ref-1',
        },
      ]);

      vi.mocked(mockLinkExtractor.fetchMessageFromLink).mockResolvedValue(referencedMessage);

      const crawler = new ReferenceCrawler({
        maxReferences: 10,
        strategies: [mockStrategy],
        linkExtractor: mockLinkExtractor,
      });

      const result = await crawler.crawl(message);

      expect(result.messages.size).toBe(1); // Only one copy
    });
  });
});
