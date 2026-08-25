/**
 * Tests for ReferenceCrawler
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReferenceCrawler } from './ReferenceCrawler.js';
import { ReferenceType } from './types.js';
import {
  createMockMessage,
  createMockCollection,
  createMockUser,
} from '../../test/mocks/Discord.mock.js';
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
    it('should preserve LINK references in history as deduped stubs', async () => {
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
          type: ReferenceType.LINK,
          discordUrl: 'https://discord.com/channels/1/2/ref-1',
        },
      ]);

      vi.mocked(mockLinkExtractor.fetchMessageFromLink).mockResolvedValue(referencedMessage);

      const crawler = new ReferenceCrawler({
        maxReferences: 10,
        strategies: [mockStrategy],
        linkExtractor: mockLinkExtractor,
        conversationHistoryMessageIds: new Set(['ref-1']),
      });

      const result = await crawler.crawl(message);

      expect(result.messages.size).toBe(1);
      const crawled = result.messages.get('ref-1');
      expect(crawled?.metadata.isDeduplicated).toBe(true);
    });

    it('should preserve REPLY references in history as deduped stubs', async () => {
      const referencedMessage = createMockMessage({
        id: 'ref-1',
        content: 'Already in history - preserved as stub',
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
        conversationHistoryMessageIds: new Set(['ref-1']),
      });

      const result = await crawler.crawl(message);

      expect(result.messages.size).toBe(1);
      const crawled = result.messages.get('ref-1');
      expect(crawled?.metadata.isDeduplicated).toBe(true);
      expect(crawled?.metadata.depth).toBe(1);
    });

    it('should NOT queue deduped stubs for further BFS traversal', async () => {
      // level-2 is behind level-1, which is in history (deduped)
      // The deduped stub should NOT cause level-2 to be traversed
      const level2Message = createMockMessage({
        id: 'level-2',
        content: 'Should not be reached',
        createdAt: new Date('2025-01-01T12:00:00Z'),
      });

      const level1Message = createMockMessage({
        id: 'level-1',
        content: 'In history',
        createdAt: new Date('2025-01-01T12:01:00Z'),
        reference: { messageId: 'level-2' } as any,
        fetchReference: vi.fn().mockResolvedValue(level2Message),
      });

      const rootMessage = createMockMessage({
        id: 'root',
        reference: { messageId: 'level-1' } as any,
        fetchReference: vi.fn().mockResolvedValue(level1Message),
      });

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
        conversationHistoryMessageIds: new Set(['level-1']),
      });

      const result = await crawler.crawl(rootMessage);

      // level-1 should be a deduped stub
      expect(result.messages.size).toBe(1);
      expect(result.messages.get('level-1')?.metadata.isDeduplicated).toBe(true);
      // level-2 should NOT be reached (no BFS traversal from deduped stubs)
      expect(result.messages.has('level-2')).toBe(false);
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

  describe('Transcript reply retargeting', () => {
    it('retargets a transcript reply to its voice-message parent', async () => {
      const voiceAttachment = { contentType: 'audio/ogg', duration: 5 };
      const parentMessage = createMockMessage({
        id: '100000000000000003',
        author: createMockUser({ id: '200000000000000001' }),
        content: 'voice note',
        attachments: createMockCollection([['att-1', voiceAttachment]]),
      });

      const transcriptMessage = createMockMessage({
        id: '100000000000000002',
        author: createMockUser({ id: 'mock-client-bot-id', bot: true }),
        content: 'this is what you said',
        reference: { messageId: '100000000000000003' } as any,
        fetchReference: vi.fn().mockResolvedValue(parentMessage),
      });

      const message = createMockMessage({
        id: '100000000000000001',
        reference: { messageId: '100000000000000002' } as any,
        fetchReference: vi.fn().mockResolvedValue(transcriptMessage),
      });

      vi.mocked(mockStrategy.extract).mockResolvedValue([
        {
          messageId: '100000000000000002',
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
      expect(result.messages.has('100000000000000003')).toBe(true);
      expect(result.messages.get('100000000000000003')?.message.author.id).toBe(
        '200000000000000001'
      );
      expect(result.messages.has('100000000000000002')).toBe(false);
    });

    it('keeps the resolved message when the fetched parent has no voice attachment', async () => {
      const plainParent = createMockMessage({
        id: '100000000000000006',
        content: 'plain text',
      });

      const noticeMessage = createMockMessage({
        id: '100000000000000005',
        author: createMockUser({ id: 'mock-client-bot-id', bot: true }),
        content: '⚠️ Please verify you are 18+ to continue.',
        reference: { messageId: '100000000000000006' } as any,
        fetchReference: vi.fn().mockResolvedValue(plainParent),
      });

      const message = createMockMessage({
        id: '100000000000000004',
        reference: { messageId: '100000000000000005' } as any,
        fetchReference: vi.fn().mockResolvedValue(noticeMessage),
      });

      vi.mocked(mockStrategy.extract).mockResolvedValue([
        {
          messageId: '100000000000000005',
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
      expect(result.messages.has('100000000000000005')).toBe(true);
      expect(result.messages.has('100000000000000006')).toBe(false);
    });

    it('keeps the resolved message when fetching the parent fails', async () => {
      const transcriptMessage = createMockMessage({
        id: '100000000000000008',
        author: createMockUser({ id: 'mock-client-bot-id', bot: true }),
        content: 'this is what you said',
        reference: { messageId: '100000000000000009' } as any,
        fetchReference: vi.fn().mockRejectedValue(new Error('Unknown Message')),
      });

      const message = createMockMessage({
        id: '100000000000000007',
        reference: { messageId: '100000000000000008' } as any,
        fetchReference: vi.fn().mockResolvedValue(transcriptMessage),
      });

      vi.mocked(mockStrategy.extract).mockResolvedValue([
        {
          messageId: '100000000000000008',
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
      expect(result.messages.has('100000000000000008')).toBe(true);
    });

    it('does not retarget a normal user message reference', async () => {
      const referencedMessage = createMockMessage({
        id: '100000000000000011',
        author: createMockUser({ id: '300000000000000001', bot: false }),
        content: 'a normal user reply target',
      });

      const message = createMockMessage({
        id: '100000000000000010',
        reference: { messageId: '100000000000000011' } as any,
        fetchReference: vi.fn().mockResolvedValue(referencedMessage),
      });

      vi.mocked(mockStrategy.extract).mockResolvedValue([
        {
          messageId: '100000000000000011',
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
      expect(result.messages.has('100000000000000011')).toBe(true);
    });

    it('does not retarget a bot message with content but no reference of its own', async () => {
      const referencedMessage = createMockMessage({
        id: '100000000000000013',
        author: createMockUser({ id: 'mock-client-bot-id', bot: true }),
        content: 'a bot reply with no reference of its own',
        reference: null,
      });

      const message = createMockMessage({
        id: '100000000000000012',
        reference: { messageId: '100000000000000013' } as any,
        fetchReference: vi.fn().mockResolvedValue(referencedMessage),
      });

      vi.mocked(mockStrategy.extract).mockResolvedValue([
        {
          messageId: '100000000000000013',
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
      expect(result.messages.has('100000000000000013')).toBe(true);
    });

    it('retargets a LINK-resolved transcript message to its voice-message parent', async () => {
      const voiceAttachment = { contentType: 'audio/ogg', duration: 5 };
      const parentMessage = createMockMessage({
        id: '100000000000000103',
        author: createMockUser({ id: '200000000000000101' }),
        content: 'voice note',
        attachments: createMockCollection([['att-1', voiceAttachment]]),
      });

      const transcriptMessage = createMockMessage({
        id: '100000000000000102',
        author: createMockUser({ id: 'mock-client-bot-id', bot: true }),
        content: 'this is what you said',
        reference: { messageId: '100000000000000103' } as any,
        fetchReference: vi.fn().mockResolvedValue(parentMessage),
      });

      const message = createMockMessage({
        id: '100000000000000101',
        content: 'https://discord.com/channels/1/2/100000000000000102',
      });

      vi.mocked(mockStrategy.extract).mockResolvedValue([
        {
          messageId: '100000000000000102',
          channelId: '2',
          guildId: '1',
          type: ReferenceType.LINK,
          discordUrl: 'https://discord.com/channels/1/2/100000000000000102',
        },
      ]);

      vi.mocked(mockLinkExtractor.fetchMessageFromLink).mockResolvedValue(transcriptMessage);

      const crawler = new ReferenceCrawler({
        maxReferences: 10,
        strategies: [mockStrategy],
        linkExtractor: mockLinkExtractor,
      });

      const result = await crawler.crawl(message);

      expect(result.messages.size).toBe(1);
      expect(result.messages.has('100000000000000103')).toBe(true);
      expect(result.messages.get('100000000000000103')?.message.author.id).toBe(
        '200000000000000101'
      );
      expect(result.messages.has('100000000000000102')).toBe(false);
    });

    it('retargets a bot notice whose parent is itself a voice message (documented residual)', async () => {
      const voiceAttachment = { contentType: 'audio/ogg', duration: 5 };
      const voiceParent = createMockMessage({
        id: '100000000000000303',
        author: createMockUser({ id: '200000000000000301' }),
        content: 'voice note',
        attachments: createMockCollection([['att-1', voiceAttachment]]),
      });

      // A transcription-failure notice: bot-authored reply with content whose
      // parent IS the voice message — stage 1 matches, and stage 2 accepts.
      const failureNotice = createMockMessage({
        id: '100000000000000302',
        author: createMockUser({ id: 'mock-client-bot-id', bot: true }),
        content: '⚠️ Could not transcribe this voice message.',
        reference: { messageId: '100000000000000303' } as any,
        fetchReference: vi.fn().mockResolvedValue(voiceParent),
      });

      const message = createMockMessage({
        id: '100000000000000301',
        reference: { messageId: '100000000000000302' } as any,
        fetchReference: vi.fn().mockResolvedValue(failureNotice),
      });

      vi.mocked(mockStrategy.extract).mockResolvedValue([
        {
          messageId: '100000000000000302',
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
      expect(result.messages.has('100000000000000303')).toBe(true);
      expect(result.messages.has('100000000000000302')).toBe(false);
    });

    it('does not re-fetch the retargeted parent when the same transcript is referenced twice', async () => {
      const voiceAttachment = { contentType: 'audio/ogg', duration: 5 };
      const parentMessage = createMockMessage({
        id: '100000000000000203',
        author: createMockUser({ id: '200000000000000201' }),
        content: 'voice note',
        attachments: createMockCollection([['att-1', voiceAttachment]]),
      });

      const transcriptMessage = createMockMessage({
        id: '100000000000000202',
        author: createMockUser({ id: 'mock-client-bot-id', bot: true }),
        content: 'this is what you said',
        reference: { messageId: '100000000000000203' } as any,
        fetchReference: vi.fn().mockResolvedValue(parentMessage),
      });

      const message = createMockMessage({
        id: '100000000000000201',
        content:
          'https://discord.com/channels/1/2/100000000000000202 and also https://discord.com/channels/1/2/100000000000000202',
      });

      vi.mocked(mockStrategy.extract).mockResolvedValue([
        {
          messageId: '100000000000000202',
          channelId: '2',
          guildId: '1',
          type: ReferenceType.LINK,
          discordUrl: 'https://discord.com/channels/1/2/100000000000000202',
        },
        {
          messageId: '100000000000000202',
          channelId: '2',
          guildId: '1',
          type: ReferenceType.LINK,
          discordUrl: 'https://discord.com/channels/1/2/100000000000000202',
        },
      ]);

      vi.mocked(mockLinkExtractor.fetchMessageFromLink).mockResolvedValue(transcriptMessage);

      const crawler = new ReferenceCrawler({
        maxReferences: 10,
        strategies: [mockStrategy],
        linkExtractor: mockLinkExtractor,
      });

      const result = await crawler.crawl(message);

      expect(result.messages.size).toBe(1);
      expect(result.messages.has('100000000000000203')).toBe(true);
      expect(transcriptMessage.fetchReference).toHaveBeenCalledTimes(1);
    });

    it('does not re-crawl the parent when two DIFFERENT transcript chunks retarget to it', async () => {
      // A long transcription posts several chunk replies against ONE voice
      // message, so two distinct pre-retarget ids converge on the same parent.
      const voiceAttachment = { contentType: 'audio/ogg', duration: 5 };
      const parentMessage = createMockMessage({
        id: '100000000000000403',
        author: createMockUser({ id: '200000000000000401' }),
        content: 'voice note',
        attachments: createMockCollection([['att-1', voiceAttachment]]),
      });

      const chunkOne = createMockMessage({
        id: '100000000000000401',
        author: createMockUser({ id: 'mock-client-bot-id', bot: true }),
        content: 'first chunk of what you said',
        reference: { messageId: '100000000000000403' } as any,
        fetchReference: vi.fn().mockResolvedValue(parentMessage),
      });
      const chunkTwo = createMockMessage({
        id: '100000000000000402',
        author: createMockUser({ id: 'mock-client-bot-id', bot: true }),
        content: 'second chunk of what you said',
        reference: { messageId: '100000000000000403' } as any,
        fetchReference: vi.fn().mockResolvedValue(parentMessage),
      });

      const message = createMockMessage({
        id: '100000000000000400',
        content:
          'https://discord.com/channels/1/2/100000000000000401 https://discord.com/channels/1/2/100000000000000402',
      });

      vi.mocked(mockStrategy.extract).mockResolvedValue([
        {
          messageId: '100000000000000401',
          channelId: '2',
          guildId: '1',
          type: ReferenceType.LINK,
          discordUrl: 'https://discord.com/channels/1/2/100000000000000401',
        },
        {
          messageId: '100000000000000402',
          channelId: '2',
          guildId: '1',
          type: ReferenceType.LINK,
          discordUrl: 'https://discord.com/channels/1/2/100000000000000402',
        },
      ]);

      vi.mocked(mockLinkExtractor.fetchMessageFromLink)
        .mockResolvedValueOnce(chunkOne)
        .mockResolvedValueOnce(chunkTwo);

      const crawler = new ReferenceCrawler({
        maxReferences: 10,
        strategies: [mockStrategy],
        linkExtractor: mockLinkExtractor,
      });

      const result = await crawler.crawl(message);

      expect(result.messages.size).toBe(1);
      expect(result.messages.has('100000000000000403')).toBe(true);
      // The parent is stored and BFS-queued exactly once: extraction runs for
      // the root and for the parent — a re-queued parent would add a third.
      expect(mockStrategy.extract).toHaveBeenCalledTimes(2);
    });
  });
});
