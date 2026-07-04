/**
 * Tests for ReferenceFormatter
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { type Collection, MessageReferenceType } from 'discord.js';
import type { Message, MessageSnapshot } from 'discord.js';
import { ReferenceFormatter } from './ReferenceFormatter.js';
import type { ReferenceMetadata } from './types.js';
import { createMockMessage } from '../../test/mocks/Discord.mock.js';
import type { MessageFormatter } from './MessageFormatter.js';
import type { SnapshotFormatter } from './SnapshotFormatter.js';

describe('ReferenceFormatter', () => {
  let formatter: ReferenceFormatter;
  let mockMessageFormatter: MessageFormatter;
  let mockSnapshotFormatter: SnapshotFormatter;

  beforeEach(() => {
    // Mock MessageFormatter
    const buildRef = (message: Message, refNum: number) => ({
      referenceNumber: refNum,
      discordMessageId: message.id,
      discordUserId: message.author.id,
      authorUsername: message.author.username,
      authorDisplayName: message.author.displayName ?? message.author.username,
      content: message.content,
      embeds: '',
      timestamp: message.createdAt.toISOString(),
      locationContext: 'this channel',
    });
    mockMessageFormatter = {
      formatMessage: vi
        .fn()
        .mockImplementation(async (message: Message, refNum: number) => buildRef(message, refNum)),
      formatMessageWithRaw: vi
        .fn()
        .mockImplementation(async (message: Message, refNum: number) => ({
          enriched: buildRef(message, refNum),
          raw: buildRef(message, refNum),
        })),
      buildRawReference: vi.fn().mockImplementation((message: Message, refNum: number) => ({
        reference: {
          ...buildRef(message, refNum),
          // Mirror the real formatter's contract: forwarded messages resolve
          // their content from snapshots (message.content is empty on them).
          content:
            message.messageSnapshots !== undefined &&
            message.messageSnapshots !== null &&
            message.messageSnapshots.size > 0
              ? (message.messageSnapshots.values().next().value?.content ?? '')
              : message.content,
        },
        attachments: [],
      })),
    } as unknown as MessageFormatter;

    // Mock SnapshotFormatter
    mockSnapshotFormatter = {
      formatSnapshot: vi
        .fn()
        .mockImplementation((snapshot: { content?: string }, refNum: number) => ({
          referenceNumber: refNum,
          discordMessageId: `snapshot-msg-${refNum}`,
          discordUserId: 'fwd-user',
          authorUsername: 'fwd',
          authorDisplayName: 'Fwd',
          content: snapshot.content ?? '',
          embeds: '',
          timestamp: new Date('2025-01-01T12:00:00Z').toISOString(),
          locationContext: '',
          isForwarded: true,
        })),
    } as any;

    formatter = new ReferenceFormatter(mockMessageFormatter, mockSnapshotFormatter);
  });

  describe('Sorting', () => {
    it('should sort by depth first (BFS order)', async () => {
      const crawledMessages = new Map<string, { message: Message; metadata: ReferenceMetadata }>([
        [
          'depth-2',
          {
            message: createMockMessage({
              id: 'depth-2',
              createdAt: new Date('2025-01-01T12:00:00Z'),
            }),
            metadata: {
              messageId: 'depth-2',
              depth: 2,
              timestamp: new Date('2025-01-01T12:00:00Z'),
            },
          },
        ],
        [
          'depth-1',
          {
            message: createMockMessage({
              id: 'depth-1',
              createdAt: new Date('2025-01-01T12:01:00Z'),
            }),
            metadata: {
              messageId: 'depth-1',
              depth: 1,
              timestamp: new Date('2025-01-01T12:01:00Z'),
            },
          },
        ],
      ]);

      const result = await formatter.format('', crawledMessages, 10);

      // Depth 1 should come before depth 2
      expect(result.references).toHaveLength(2);
      expect(result.references[0].discordMessageId).toBe('depth-1');
      expect(result.references[0].referenceNumber).toBe(1);
      expect(result.references[1].discordMessageId).toBe('depth-2');
      expect(result.references[1].referenceNumber).toBe(2);
    });

    it('should sort chronologically within same depth level', async () => {
      const crawledMessages = new Map<string, { message: Message; metadata: ReferenceMetadata }>([
        [
          'newer',
          {
            message: createMockMessage({
              id: 'newer',
              createdAt: new Date('2025-01-01T12:02:00Z'),
            }),
            metadata: {
              messageId: 'newer',
              depth: 1,
              timestamp: new Date('2025-01-01T12:02:00Z'),
            },
          },
        ],
        [
          'older',
          {
            message: createMockMessage({
              id: 'older',
              createdAt: new Date('2025-01-01T12:00:00Z'),
            }),
            metadata: {
              messageId: 'older',
              depth: 1,
              timestamp: new Date('2025-01-01T12:00:00Z'),
            },
          },
        ],
      ]);

      const result = await formatter.format('', crawledMessages, 10);

      // Older message should come first within same depth
      expect(result.references).toHaveLength(2);
      expect(result.references[0].discordMessageId).toBe('older');
      expect(result.references[1].discordMessageId).toBe('newer');
    });

    it('should combine depth and chronological sorting', async () => {
      const crawledMessages = new Map<string, { message: Message; metadata: ReferenceMetadata }>([
        [
          'depth1-newer',
          {
            message: createMockMessage({
              id: 'depth1-newer',
              createdAt: new Date('2025-01-01T12:02:00Z'),
            }),
            metadata: {
              messageId: 'depth1-newer',
              depth: 1,
              timestamp: new Date('2025-01-01T12:02:00Z'),
            },
          },
        ],
        [
          'depth2-older',
          {
            message: createMockMessage({
              id: 'depth2-older',
              createdAt: new Date('2025-01-01T12:00:00Z'),
            }),
            metadata: {
              messageId: 'depth2-older',
              depth: 2,
              timestamp: new Date('2025-01-01T12:00:00Z'),
            },
          },
        ],
        [
          'depth1-older',
          {
            message: createMockMessage({
              id: 'depth1-older',
              createdAt: new Date('2025-01-01T12:01:00Z'),
            }),
            metadata: {
              messageId: 'depth1-older',
              depth: 1,
              timestamp: new Date('2025-01-01T12:01:00Z'),
            },
          },
        ],
      ]);

      const result = await formatter.format('', crawledMessages, 10);

      // Expected order: depth 1 (older), depth 1 (newer), depth 2 (older)
      expect(result.references).toHaveLength(3);
      expect(result.references[0].discordMessageId).toBe('depth1-older');
      expect(result.references[1].discordMessageId).toBe('depth1-newer');
      expect(result.references[2].discordMessageId).toBe('depth2-older');
    });
  });

  describe('Reference Numbering', () => {
    it('should assign sequential reference numbers starting from 1', async () => {
      const crawledMessages = new Map<string, { message: Message; metadata: ReferenceMetadata }>([
        [
          'ref-1',
          {
            message: createMockMessage({
              id: 'ref-1',
              createdAt: new Date('2025-01-01T12:00:00Z'),
            }),
            metadata: {
              messageId: 'ref-1',
              depth: 1,
              timestamp: new Date('2025-01-01T12:00:00Z'),
            },
          },
        ],
        [
          'ref-2',
          {
            message: createMockMessage({
              id: 'ref-2',
              createdAt: new Date('2025-01-01T12:01:00Z'),
            }),
            metadata: {
              messageId: 'ref-2',
              depth: 1,
              timestamp: new Date('2025-01-01T12:01:00Z'),
            },
          },
        ],
        [
          'ref-3',
          {
            message: createMockMessage({
              id: 'ref-3',
              createdAt: new Date('2025-01-01T12:02:00Z'),
            }),
            metadata: {
              messageId: 'ref-3',
              depth: 1,
              timestamp: new Date('2025-01-01T12:02:00Z'),
            },
          },
        ],
      ]);

      const result = await formatter.format('', crawledMessages, 10);

      expect(result.references[0].referenceNumber).toBe(1);
      expect(result.references[1].referenceNumber).toBe(2);
      expect(result.references[2].referenceNumber).toBe(3);
    });
  });

  describe('Link Replacement', () => {
    it('should replace Discord links with [Reference N] placeholders', async () => {
      const crawledMessages = new Map<string, { message: Message; metadata: ReferenceMetadata }>([
        [
          'ref-1',
          {
            message: createMockMessage({
              id: 'ref-1',
              createdAt: new Date('2025-01-01T12:00:00Z'),
            }),
            metadata: {
              messageId: 'ref-1',
              depth: 1,
              timestamp: new Date('2025-01-01T12:00:00Z'),
              discordUrl: 'https://discord.com/channels/123/456/789',
            },
          },
        ],
      ]);

      const originalContent = 'Check this https://discord.com/channels/123/456/789';

      const result = await formatter.format(originalContent, crawledMessages, 10);

      expect(result.updatedContent).toBe('Check this [Reference 1]');
    });

    it('should replace multiple links with correct reference numbers', async () => {
      const crawledMessages = new Map<string, { message: Message; metadata: ReferenceMetadata }>([
        [
          'ref-1',
          {
            message: createMockMessage({
              id: 'ref-1',
              createdAt: new Date('2025-01-01T12:00:00Z'),
            }),
            metadata: {
              messageId: 'ref-1',
              depth: 1,
              timestamp: new Date('2025-01-01T12:00:00Z'),
              discordUrl: 'https://discord.com/channels/111/222/333',
            },
          },
        ],
        [
          'ref-2',
          {
            message: createMockMessage({
              id: 'ref-2',
              createdAt: new Date('2025-01-01T12:01:00Z'),
            }),
            metadata: {
              messageId: 'ref-2',
              depth: 1,
              timestamp: new Date('2025-01-01T12:01:00Z'),
              discordUrl: 'https://discord.com/channels/444/555/666',
            },
          },
        ],
      ]);

      const originalContent =
        'See https://discord.com/channels/111/222/333 and https://discord.com/channels/444/555/666';

      const result = await formatter.format(originalContent, crawledMessages, 10);

      expect(result.updatedContent).toBe('See [Reference 1] and [Reference 2]');
    });

    it('should not replace links for references without discordUrl', async () => {
      const crawledMessages = new Map<string, { message: Message; metadata: ReferenceMetadata }>([
        [
          'ref-1',
          {
            message: createMockMessage({
              id: 'ref-1',
              createdAt: new Date('2025-01-01T12:00:00Z'),
            }),
            metadata: {
              messageId: 'ref-1',
              depth: 1,
              timestamp: new Date('2025-01-01T12:00:00Z'),
              // No discordUrl (e.g., reply reference)
            },
          },
        ],
      ]);

      const originalContent = 'This is a reply reference';

      const result = await formatter.format(originalContent, crawledMessages, 10);

      // Content should remain unchanged
      expect(result.updatedContent).toBe('This is a reply reference');
    });
  });

  describe('Deduplicated Stubs', () => {
    it('should produce minimal ReferencedMessage for deduped metadata', async () => {
      const crawledMessages = new Map<string, { message: Message; metadata: ReferenceMetadata }>([
        [
          'deduped-1',
          {
            message: createMockMessage({
              id: 'deduped-1',
              content: 'This is the original message content',
              createdAt: new Date('2025-01-01T12:00:00Z'),
            }),
            metadata: {
              messageId: 'deduped-1',
              depth: 1,
              timestamp: new Date('2025-01-01T12:00:00Z'),
              isDeduplicated: true,
            },
          },
        ],
      ]);

      const result = await formatter.format('', crawledMessages, 10);

      expect(result.references).toHaveLength(1);
      const ref = result.references[0];
      expect(ref.isDeduplicated).toBe(true);
      expect(ref.content).toBe('This is the original message content');
      expect(ref.embeds).toBe('');
      expect(ref.locationContext).toBe('');
      expect(ref.referenceNumber).toBe(1);
      // Should NOT call messageFormatter.formatMessage
      expect(mockMessageFormatter.formatMessage).not.toHaveBeenCalled();
    });

    it('should truncate long content in deduped stubs to ~100 chars', async () => {
      const longContent = 'A'.repeat(200);
      const crawledMessages = new Map<string, { message: Message; metadata: ReferenceMetadata }>([
        [
          'deduped-long',
          {
            message: createMockMessage({
              id: 'deduped-long',
              content: longContent,
              createdAt: new Date('2025-01-01T12:00:00Z'),
            }),
            metadata: {
              messageId: 'deduped-long',
              depth: 1,
              timestamp: new Date('2025-01-01T12:00:00Z'),
              isDeduplicated: true,
            },
          },
        ],
      ]);

      const result = await formatter.format('', crawledMessages, 10);

      const ref = result.references[0];
      expect(ref.content.length).toBeLessThanOrEqual(103); // 100 + '...'
      expect(ref.content.endsWith('...')).toBe(true);
    });

    it('should not truncate short content in deduped stubs', async () => {
      const crawledMessages = new Map<string, { message: Message; metadata: ReferenceMetadata }>([
        [
          'deduped-short',
          {
            message: createMockMessage({
              id: 'deduped-short',
              content: 'Short',
              createdAt: new Date('2025-01-01T12:00:00Z'),
            }),
            metadata: {
              messageId: 'deduped-short',
              depth: 1,
              timestamp: new Date('2025-01-01T12:00:00Z'),
              isDeduplicated: true,
            },
          },
        ],
      ]);

      const result = await formatter.format('', crawledMessages, 10);

      expect(result.references[0].content).toBe('Short');
    });

    it('should fold the attachment marker into an image-only deduped stub (empty text)', async () => {
      // Image-only reply target: empty text + one image attachment. The deduped
      // stub the bot ships to the worker must carry the attachment marker so the
      // model can correlate it with the (image-described) history entry; without
      // it the stub collapses to an empty quote and the model reports "no image."
      vi.mocked(mockMessageFormatter.buildRawReference).mockReturnValueOnce({
        reference: {
          referenceNumber: 1,
          discordMessageId: 'deduped-image-only',
          discordUserId: 'user-1',
          authorUsername: 'someone',
          authorDisplayName: 'Someone',
          content: '',
          embeds: '',
          timestamp: new Date('2025-01-01T12:00:00Z').toISOString(),
          locationContext: 'this channel',
          attachments: [
            { url: 'https://cdn/photo.png', contentType: 'image/png', name: 'photo.png' },
          ],
        },
        attachments: [],
      });

      const crawledMessages = new Map<string, { message: Message; metadata: ReferenceMetadata }>([
        [
          'deduped-image-only',
          {
            message: createMockMessage({
              id: 'deduped-image-only',
              content: '',
              createdAt: new Date('2025-01-01T12:00:00Z'),
            }),
            metadata: {
              messageId: 'deduped-image-only',
              depth: 1,
              timestamp: new Date('2025-01-01T12:00:00Z'),
              isDeduplicated: true,
            },
          },
        ],
      ]);

      const result = await formatter.format('', crawledMessages, 10);

      const ref = result.references[0];
      expect(ref.isDeduplicated).toBe(true);
      expect(ref.content).toBe('[image/png: photo.png]');
    });

    it('should use snapshot content for deduped forwarded messages', async () => {
      // Forwarded messages have empty message.content — real content is in snapshots
      const snapshotsMap = new Map();
      snapshotsMap.set('snapshot-0', {
        content: 'Forwarded snapshot content here',
        attachments: new Map(),
        embeds: [],
      });
      const messageSnapshots = {
        size: snapshotsMap.size,
        values: () => snapshotsMap.values(),
        first: () => snapshotsMap.values().next().value,
      } as unknown as Collection<string, MessageSnapshot>;

      const forwardedMessage = createMockMessage({
        id: 'forwarded-deduped',
        content: '', // Empty — forwarded messages have no direct content
        createdAt: new Date('2025-01-01T12:00:00Z'),
        reference: { type: MessageReferenceType.Forward } as Message['reference'],
        messageSnapshots,
      });

      const crawledMessages = new Map<string, { message: Message; metadata: ReferenceMetadata }>([
        [
          'forwarded-deduped',
          {
            message: forwardedMessage,
            metadata: {
              messageId: 'forwarded-deduped',
              depth: 1,
              timestamp: new Date('2025-01-01T12:00:00Z'),
              isDeduplicated: true,
            },
          },
        ],
      ]);

      const result = await formatter.format('', crawledMessages, 10);

      expect(result.references).toHaveLength(1);
      const ref = result.references[0];
      expect(ref.isDeduplicated).toBe(true);
      // Should use snapshot content, not empty message.content
      expect(ref.content).toBe('Forwarded snapshot content here');
    });

    it('should replace Discord links for deduped stubs with discordUrl', async () => {
      const crawledMessages = new Map<string, { message: Message; metadata: ReferenceMetadata }>([
        [
          'deduped-link',
          {
            message: createMockMessage({
              id: 'deduped-link',
              content: 'Content in history',
              createdAt: new Date('2025-01-01T12:00:00Z'),
            }),
            metadata: {
              messageId: 'deduped-link',
              depth: 1,
              timestamp: new Date('2025-01-01T12:00:00Z'),
              discordUrl: 'https://discord.com/channels/1/2/3',
              isDeduplicated: true,
            },
          },
        ],
      ]);

      const result = await formatter.format(
        'See https://discord.com/channels/1/2/3',
        crawledMessages,
        10
      );

      expect(result.updatedContent).toBe('See [Reference 1]');
    });
  });

  describe('Limit Enforcement', () => {
    it('should apply maxReferences limit', async () => {
      const crawledMessages = new Map<string, { message: Message; metadata: ReferenceMetadata }>();

      // Add 15 messages
      for (let i = 0; i < 15; i++) {
        crawledMessages.set(`ref-${i}`, {
          message: createMockMessage({
            id: `ref-${i}`,
            createdAt: new Date(`2025-01-01T12:${String(i).padStart(2, '0')}:00Z`),
          }),
          metadata: {
            messageId: `ref-${i}`,
            depth: 1,
            timestamp: new Date(`2025-01-01T12:${String(i).padStart(2, '0')}:00Z`),
          },
        });
      }

      const result = await formatter.format('', crawledMessages, 10);

      // Should limit to 10
      expect(result.references).toHaveLength(10);
    });
  });

  describe('collectRaw (raw assembly envelope)', () => {
    it('returns full pre-dedup raw snapshots alongside stubbed enriched references', async () => {
      const longContent = 'B'.repeat(200);
      const crawledMessages = new Map<string, { message: Message; metadata: ReferenceMetadata }>([
        [
          'deduped-1',
          {
            message: createMockMessage({ id: 'deduped-1', content: longContent }),
            metadata: {
              messageId: 'deduped-1',
              depth: 1,
              timestamp: new Date('2025-01-01T00:00:00Z'),
              isDeduplicated: true,
            },
          },
        ],
      ]);

      const result = await formatter.format('content', crawledMessages, 10, { collectRaw: true });

      // Enriched side: stubbed (truncated, isDeduplicated).
      expect(result.references[0].isDeduplicated).toBe(true);
      expect(result.references[0].content.length).toBeLessThan(longContent.length);
      // Raw side: FULL content, same reference number — the worker re-derives
      // dedup against its own hydrated history.
      expect(result.rawReferences).toHaveLength(1);
      expect(result.rawReferences?.[0].content).toBe(longContent);
      expect(result.rawReferences?.[0].referenceNumber).toBe(result.references[0].referenceNumber);
    });

    it('collects the raw snapshot for regular messages (raw = pre-transcript content)', async () => {
      const crawledMessages = new Map<string, { message: Message; metadata: ReferenceMetadata }>([
        [
          'regular-raw',
          {
            message: createMockMessage({ id: 'regular-raw', content: 'plain message' }),
            metadata: {
              messageId: 'regular-raw',
              depth: 1,
              timestamp: new Date('2025-01-01T00:00:00Z'),
            },
          },
        ],
      ]);

      const result = await formatter.format('content', crawledMessages, 10, { collectRaw: true });

      expect(result.rawReferences).toHaveLength(1);
      expect(result.rawReferences?.[0].content).toBe('plain message');
      expect(result.rawReferences?.[0].referenceNumber).toBe(result.references[0].referenceNumber);
    });

    it('collects one raw entry per forwarded snapshot with consistent numbering', async () => {
      const snapshotsMap = new Map();
      snapshotsMap.set('s0', { content: 'first snapshot', attachments: new Map(), embeds: [] });
      snapshotsMap.set('s1', { content: 'second snapshot', attachments: new Map(), embeds: [] });
      const messageSnapshots = {
        size: snapshotsMap.size,
        values: () => snapshotsMap.values(),
        first: () => snapshotsMap.values().next().value,
      } as unknown as Collection<string, MessageSnapshot>;

      const forwardedMessage = createMockMessage({
        id: 'forwarded-raw',
        content: '',
        createdAt: new Date('2025-01-01T12:00:00Z'),
        reference: { type: MessageReferenceType.Forward } as Message['reference'],
        messageSnapshots,
      });

      const crawledMessages = new Map<string, { message: Message; metadata: ReferenceMetadata }>([
        [
          'forwarded-raw',
          {
            message: forwardedMessage,
            metadata: {
              messageId: 'forwarded-raw',
              depth: 1,
              timestamp: new Date('2025-01-01T12:00:00Z'),
            },
          },
        ],
      ]);

      const result = await formatter.format('', crawledMessages, 10, { collectRaw: true });

      // Each snapshot expands to its own enriched AND raw entry, numbers aligned.
      expect(result.references).toHaveLength(2);
      expect(result.rawReferences).toHaveLength(2);
      expect(result.rawReferences?.map(r => r.referenceNumber)).toEqual(
        result.references.map(r => r.referenceNumber)
      );
      expect(result.rawReferences?.[1].content).toBe('second snapshot');
    });

    it('omits rawReferences entirely when collectRaw is not requested', async () => {
      const crawledMessages = new Map<string, { message: Message; metadata: ReferenceMetadata }>([
        [
          'regular-1',
          {
            message: createMockMessage({ id: 'regular-1', content: 'hello' }),
            metadata: {
              messageId: 'regular-1',
              depth: 1,
              timestamp: new Date('2025-01-01T00:00:00Z'),
            },
          },
        ],
      ]);

      const result = await formatter.format('content', crawledMessages, 10);

      expect(result.rawReferences).toBeUndefined();
      expect(result.references).toHaveLength(1);
    });
  });
});
