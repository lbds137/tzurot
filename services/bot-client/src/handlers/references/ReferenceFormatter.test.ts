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
      buildForwardMarker: vi.fn(() => Promise.resolve('(forwarded message)')),
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
      expect(result.rawReferences).toHaveLength(2);
      expect(result.rawReferences[0].discordMessageId).toBe('depth-1');
      expect(result.rawReferences[0].referenceNumber).toBe(1);
      expect(result.rawReferences[1].discordMessageId).toBe('depth-2');
      expect(result.rawReferences[1].referenceNumber).toBe(2);
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
      expect(result.rawReferences).toHaveLength(2);
      expect(result.rawReferences[0].discordMessageId).toBe('older');
      expect(result.rawReferences[1].discordMessageId).toBe('newer');
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
      expect(result.rawReferences).toHaveLength(3);
      expect(result.rawReferences[0].discordMessageId).toBe('depth1-older');
      expect(result.rawReferences[1].discordMessageId).toBe('depth1-newer');
      expect(result.rawReferences[2].discordMessageId).toBe('depth2-older');
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

      expect(result.rawReferences[0].referenceNumber).toBe(1);
      expect(result.rawReferences[1].referenceNumber).toBe(2);
      expect(result.rawReferences[2].referenceNumber).toBe(3);
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

  // Deduplication is DECIDED here (the crawler's metadata routes it) but no
  // longer SHAPED here. ai-worker re-runs the decision against its own assembled
  // history and projects the stub at render time, so this side ships the full
  // snapshot and lets the worker subtract.
  describe('Deduplicated References', () => {
    it('emits the FULL snapshot for a deduped reference', async () => {
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

      expect(result.rawReferences).toHaveLength(1);
      const ref = result.rawReferences[0];
      // Not flagged here: the flag is the WORKER's, set when its own dedup
      // re-run agrees. Flagging it on this side would be a second opinion.
      expect(ref.isDeduplicated).toBeUndefined();
      expect(ref.content).toBe('This is the original message content');
      expect(ref.referenceNumber).toBe(1);
      // The deduped branch builds the raw snapshot like any other reference.
      expect(mockMessageFormatter.buildRawReference).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'deduped-1' }),
        1
      );
    });

    it("does NOT truncate the content — capping is the renderer's single decision", async () => {
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

      expect(result.rawReferences[0].content).toBe(longContent);
    });

    it('leaves short content alone too', async () => {
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

      expect(result.rawReferences[0].content).toBe('Short');
    });

    it('ships an image-only reference with its attachments INTACT', async () => {
      // The stub this replaced folded a `[image/png: photo.png]` text marker
      // into the content and dropped the attachment list. That cost the worker
      // the only structured record of what was attached, so an image whose
      // vision call never ran rendered as nothing at all.
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

      const ref = result.rawReferences[0];
      expect(ref.content).toBe('');
      expect(ref.attachments).toEqual([
        { url: 'https://cdn/photo.png', contentType: 'image/png', name: 'photo.png' },
      ]);
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

      expect(result.rawReferences).toHaveLength(1);
      const ref = result.rawReferences[0];
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
      expect(result.rawReferences).toHaveLength(10);
    });
  });

  describe('Raw assembly envelope', () => {
    it('carries the untruncated snapshot for a deduped reference', async () => {
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

      const result = await formatter.format('content', crawledMessages, 10);

      // The deduped branch ships the full snapshot: the worker re-derives dedup
      // against its own hydrated history and projects the stub at render time.
      expect(result.rawReferences).toHaveLength(1);
      expect(result.rawReferences[0].content).toBe(longContent);
      expect(result.rawReferences[0].referenceNumber).toBe(1);
    });

    it('collects the raw snapshot for regular messages (pre-enrichment content)', async () => {
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

      const result = await formatter.format('content', crawledMessages, 10);

      expect(result.rawReferences).toHaveLength(1);
      expect(result.rawReferences[0].content).toBe('plain message');
      expect(result.rawReferences[0].referenceNumber).toBe(1);
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

      const result = await formatter.format('', crawledMessages, 10);

      // Each snapshot expands to its own raw entry, numbered sequentially.
      expect(result.rawReferences).toHaveLength(2);
      expect(result.rawReferences.map(r => r.referenceNumber)).toEqual([1, 2]);
      expect(result.rawReferences[1].content).toBe('second snapshot');
    });

    it('resolves no marker at all for a forward with zero snapshots', async () => {
      // isForwardedMessage is true on reference.type alone, so this arm is
      // reachable with an empty collection — forwardedMessageUtils' own
      // docstring records that Discord does not always populate snapshots.
      // Resolving the marker here would spend a permission gate, and on a
      // private-thread origin a REST fetch, on a value nothing consumes.
      const emptySnapshots = {
        size: 0,
        values: () => new Map().values(),
        first: () => undefined,
      } as unknown as Collection<string, MessageSnapshot>;

      const forwardedMessage = createMockMessage({
        id: 'forwarded-empty',
        content: '',
        createdAt: new Date('2025-01-01T12:00:00Z'),
        reference: { type: MessageReferenceType.Forward } as Message['reference'],
        messageSnapshots: emptySnapshots,
      });

      const crawledMessages = new Map<string, { message: Message; metadata: ReferenceMetadata }>([
        [
          'forwarded-empty',
          {
            message: forwardedMessage,
            metadata: {
              messageId: 'forwarded-empty',
              depth: 1,
              timestamp: new Date('2025-01-01T12:00:00Z'),
              discordUrl: 'https://discord.com/channels/1/2/3',
            },
          },
        ],
      ]);

      const result = await formatter.format('', crawledMessages, 10);

      expect(mockSnapshotFormatter.buildForwardMarker).not.toHaveBeenCalled();
      expect(mockSnapshotFormatter.formatSnapshot).not.toHaveBeenCalled();
      expect(result.rawReferences).toEqual([]);
    });

    it('resolves the forward marker ONCE for a multi-snapshot forward', async () => {
      // The marker depends only on the forwarding message, and producing it runs
      // a permission gate that reaches a REST fetch on a private-thread origin.
      // Computing it per snapshot would repeat that call for an answer that
      // cannot differ between iterations, so the count is the assertion.
      const snapshotsMap = new Map();
      snapshotsMap.set('s0', { content: 'first snapshot', attachments: new Map(), embeds: [] });
      snapshotsMap.set('s1', { content: 'second snapshot', attachments: new Map(), embeds: [] });
      const messageSnapshots = {
        size: snapshotsMap.size,
        values: () => snapshotsMap.values(),
        first: () => snapshotsMap.values().next().value,
      } as unknown as Collection<string, MessageSnapshot>;

      const forwardedMessage = createMockMessage({
        id: 'forwarded-once',
        content: '',
        createdAt: new Date('2025-01-01T12:00:00Z'),
        reference: { type: MessageReferenceType.Forward } as Message['reference'],
        messageSnapshots,
      });

      const crawledMessages = new Map<string, { message: Message; metadata: ReferenceMetadata }>([
        [
          'forwarded-once',
          {
            message: forwardedMessage,
            metadata: {
              messageId: 'forwarded-once',
              depth: 1,
              timestamp: new Date('2025-01-01T12:00:00Z'),
              discordUrl: 'https://discord.com/channels/1/2/3',
            },
          },
        ],
      ]);

      const result = await formatter.format(
        'See https://discord.com/channels/1/2/3',
        crawledMessages,
        10
      );

      expect(mockSnapshotFormatter.buildForwardMarker).toHaveBeenCalledTimes(1);
      expect(mockSnapshotFormatter.formatSnapshot).toHaveBeenCalledTimes(2);
      // Every snapshot receives the SAME resolved marker — the point of hoisting
      // is one answer per forward, not merely one call.
      const markers = vi
        .mocked(mockSnapshotFormatter.formatSnapshot)
        .mock.calls.map(call => call[3]);
      expect(markers).toEqual(['(forwarded message)', '(forwarded message)']);
      // Ordering is now structural rather than disciplined: the loop body has no
      // await left, so numbering cannot interleave. Still pinned, because the
      // numbering contract is what callers depend on.
      expect(result.rawReferences.map(r => r.referenceNumber)).toEqual([1, 2]);
      // All snapshots share the crawled entry's discordUrl and trackLink uses
      // Map.set, so the LAST snapshot's number wins the link.
      expect(result.updatedContent).toBe('See [Reference 2]');
    });
  });
});
