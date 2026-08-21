/**
 * Tests for SnapshotFormatter
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SnapshotFormatter } from './SnapshotFormatter.js';
import { createMockMessage } from '../../test/mocks/Discord.mock.js';
import {
  ChannelType,
  Collection,
  PermissionFlagsBits,
  type Channel,
  type MessageSnapshot,
  type APIEmbed,
} from 'discord.js';

// Mock the utility functions
vi.mock('../../utils/discordContext.js', () => ({
  extractDiscordEnvironment: vi.fn().mockReturnValue({
    guildId: 'guild-123',
    guildName: 'Test Guild',
    channelId: 'channel-456',
    channelName: 'general',
  }),
}));

vi.mock('@tzurot/common-types/utils/environmentFormatter', async () => {
  const actual = await vi.importActual<
    typeof import('@tzurot/common-types/utils/environmentFormatter')
  >('@tzurot/common-types/utils/environmentFormatter');
  return {
    ...actual,
    formatLocationAsXml: vi
      .fn()
      .mockReturnValue('<location type="guild"><server name="Test Guild"/></location>'),
  };
});

vi.mock('../../utils/attachmentExtractor.js', () => ({
  extractAttachments: vi.fn().mockReturnValue(null),
}));

vi.mock('../../utils/embedImageExtractor.js', () => ({
  extractEmbedImages: vi.fn().mockReturnValue([]),
}));

vi.mock('../../utils/EmbedParser.js', () => ({
  EmbedParser: {
    parseEmbed: vi.fn().mockImplementation((embed: APIEmbed) => {
      return embed.title ? `${embed.title}\n${embed.description || ''}` : embed.description || '';
    }),
  },
}));

describe('SnapshotFormatter', () => {
  // Most tests here exercise snapshot FORMATTING, for which the marker is an
  // opaque passed-in string. The gate that produces it is tested directly
  // against buildForwardMarker in the 'Location Context' block below.
  const GENERIC_MARKER = '(forwarded message)';

  let formatter: SnapshotFormatter;

  beforeEach(() => {
    vi.clearAllMocks();
    formatter = new SnapshotFormatter();
  });

  // Use Record<string, unknown> for flexible mock input
  function createMockSnapshot(overrides: Record<string, unknown> = {}): MessageSnapshot {
    return {
      content: 'Snapshot content',
      createdTimestamp: 1704110400000, // 2024-01-01T12:00:00Z
      attachments: null,
      embeds: [],
      ...overrides,
    } as unknown as MessageSnapshot;
  }

  describe('forwarded stickers', () => {
    it('attaches a forwarded snapshot sticker so vision can describe it', async () => {
      // A forward carries its stickers on the SNAPSHOT, not on the forwarding
      // message, and this path formats the snapshot directly — so it needs its
      // own extractor. Before this, a forwarded sticker reached the model as a
      // name with no image behind it.
      const snapshot = createMockSnapshot({
        stickers: new Map([
          [
            '77',
            {
              id: '77',
              name: 'shipit',
              format: 1, // StickerFormatType.PNG
              url: 'https://cdn.discordapp.com/stickers/77.png',
            },
          ],
        ]),
      });

      const forwardedFrom = createMockMessage();

      const result = formatter.formatSnapshot(snapshot, 1, forwardedFrom, GENERIC_MARKER);

      expect(result.attachments).toEqual([
        expect.objectContaining({ id: '77', isSticker: true, contentType: 'image/png' }),
      ]);
      // The rasterizable case carries BOTH halves: image attachment above,
      // name line in content (default mock content is 'Snapshot content').
      expect(result.content).toBe('Snapshot content\n\n[Stickers: shipit]');
    });

    it('renders the sticker name line for a non-rasterizable (Lottie) sticker', async () => {
      // A Lottie sticker has no raster form, so stickersToAttachments filters
      // it out — the name line is its ONLY trace. Before this, a forwarded
      // Lottie sticker was entirely invisible to the model: empty content,
      // undefined attachments.
      const snapshot = createMockSnapshot({
        content: '',
        stickers: new Map([
          [
            '88',
            {
              id: '88',
              name: 'wave',
              description: 'Wumpus waves hello',
              format: 3, // StickerFormatType.Lottie
              url: 'https://cdn.discordapp.com/stickers/88.json',
            },
          ],
        ]),
      });

      const result = formatter.formatSnapshot(snapshot, 1, createMockMessage(), GENERIC_MARKER);

      expect(result.content).toBe('[Stickers: wave — Wumpus waves hello]');
      expect(result.attachments).toBeUndefined();
    });

    it('appends the sticker name line after existing snapshot content', async () => {
      const snapshot = createMockSnapshot({
        content: 'look at this',
        stickers: new Map([
          [
            '77',
            {
              id: '77',
              name: 'shipit',
              description: null,
              format: 1, // StickerFormatType.PNG
              url: 'https://cdn.discordapp.com/stickers/77.png',
            },
          ],
        ]),
      });

      const result = formatter.formatSnapshot(snapshot, 1, createMockMessage(), GENERIC_MARKER);

      expect(result.content).toBe('look at this\n\n[Stickers: shipit]');
    });

    it('scopes the name line to THIS snapshot — the forwarding message stickers stay out', async () => {
      // formatSnapshot runs once per snapshot; pulling the containing
      // message's (or sibling snapshots') stickers in would duplicate names
      // across every reference entry of a multi-snapshot forward.
      const snapshot = createMockSnapshot({ content: 'plain text', stickers: new Map() });
      const forwardedFrom = createMockMessage({
        stickers: new Map([
          ['99', { id: '99', name: 'container-sticker', description: null, format: 1 }],
        ]),
      });

      const result = formatter.formatSnapshot(snapshot, 1, forwardedFrom, GENERIC_MARKER);

      expect(result.content).toBe('plain text');
    });
  });

  describe('Basic Formatting', () => {
    it('should format a simple snapshot', async () => {
      const snapshot = createMockSnapshot({
        content: 'Forwarded message content',
        createdTimestamp: 1704110400000,
      });

      const forwardedFrom = createMockMessage({
        id: 'forward-msg-123',
        createdAt: new Date('2025-01-01T14:00:00Z'),
      });

      const result = formatter.formatSnapshot(snapshot, 1, forwardedFrom, GENERIC_MARKER);

      expect(result).toEqual({
        referenceNumber: 1,
        discordMessageId: 'forward-msg-123',
        webhookId: undefined,
        discordUserId: 'unknown',
        authorUsername: 'Unknown User',
        authorDisplayName: 'Unknown User',
        content: 'Forwarded message content',
        embeds: '',
        timestamp: '2024-01-01T12:00:00.000Z',
        locationContext:
          '<location type="guild"><server name="Test Guild"/></location> (forwarded message)',
        attachments: undefined,
        isForwarded: true,
      });
    });

    it('strips our own -# footer from a forwarded snapshot of one of our replies', async () => {
      const snapshot = createMockSnapshot({
        content:
          'The answer is 42.\n-# Model: [glm-5.2](<https://docs.z.ai/guides/llm/glm-5.2>) • via Z.AI Coding Plan',
        createdTimestamp: 1704110400000,
      });

      const result = formatter.formatSnapshot(
        snapshot,
        1,
        createMockMessage({ id: 'fwd-1' }),
        GENERIC_MARKER
      );

      expect(result.content).toBe('The answer is 42.');
    });

    it('strips footers per-snapshot, not just from the first one', async () => {
      // formatSnapshot runs once per snapshot in a multi-snapshot forward, so
      // the strip cannot delegate to an accessor that reads only the first.
      const second = createMockSnapshot({
        content: 'Second reply.\n-# 👻 Incognito Mode • Memories not being saved',
        createdTimestamp: 1704110400000,
      });

      const result = formatter.formatSnapshot(
        second,
        2,
        createMockMessage({ id: 'fwd-1' }),
        GENERIC_MARKER
      );

      expect(result.content).toBe('Second reply.');
    });

    it("leaves a forwarded human's own -# subtext alone", async () => {
      const snapshot = createMockSnapshot({
        content: 'my hot take\n-# just my opinion though',
        createdTimestamp: 1704110400000,
      });

      const result = formatter.formatSnapshot(
        snapshot,
        1,
        createMockMessage({ id: 'fwd-1' }),
        GENERIC_MARKER
      );

      expect(result.content).toBe('my hot take\n-# just my opinion though');
    });

    it('should handle empty content', async () => {
      const snapshot = createMockSnapshot({
        content: null as any,
      });

      const forwardedFrom = createMockMessage();

      const result = formatter.formatSnapshot(snapshot, 1, forwardedFrom, GENERIC_MARKER);

      expect(result.content).toBe('');
    });

    it('should use forwardedFrom timestamp when snapshot has no timestamp', async () => {
      const snapshot = createMockSnapshot({
        createdTimestamp: null as any,
      });

      const forwardedFrom = createMockMessage({
        createdAt: new Date('2025-01-01T15:00:00Z'),
      });

      const result = formatter.formatSnapshot(snapshot, 1, forwardedFrom, GENERIC_MARKER);

      expect(result.timestamp).toBe('2025-01-01T15:00:00.000Z');
    });

    it('should always mark as forwarded', async () => {
      const snapshot = createMockSnapshot();
      const forwardedFrom = createMockMessage();

      const result = formatter.formatSnapshot(snapshot, 5, forwardedFrom, GENERIC_MARKER);

      expect(result.isForwarded).toBe(true);
      expect(result.referenceNumber).toBe(5);
    });
  });

  describe('Attachments', () => {
    it('should include attachments when present', async () => {
      const { extractAttachments } = await import('../../utils/attachmentExtractor.js');

      vi.mocked(extractAttachments).mockReturnValue([
        {
          url: 'https://example.com/image.png',
          contentType: 'image/png',
          name: 'image.png',
        },
      ]);

      const snapshot = createMockSnapshot({
        attachments: {} as any,
      });

      const forwardedFrom = createMockMessage();

      const result = formatter.formatSnapshot(snapshot, 1, forwardedFrom, GENERIC_MARKER);

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments?.[0].url).toBe('https://example.com/image.png');
    });

    it('should handle null attachments', async () => {
      const snapshot = createMockSnapshot({
        attachments: null,
      });

      const forwardedFrom = createMockMessage();

      const result = formatter.formatSnapshot(snapshot, 1, forwardedFrom, GENERIC_MARKER);

      expect(result.attachments).toBeUndefined();
    });

    it('should combine regular attachments and embed images', async () => {
      const { extractAttachments } = await import('../../utils/attachmentExtractor.js');
      const { extractEmbedImages } = await import('../../utils/embedImageExtractor.js');

      vi.mocked(extractAttachments).mockReturnValue([
        {
          url: 'https://example.com/file.pdf',
          contentType: 'application/pdf',
          name: 'file.pdf',
        },
      ]);

      vi.mocked(extractEmbedImages).mockReturnValue([
        {
          url: 'https://example.com/embed-image.png',
          contentType: 'image/png',
        },
      ]);

      const snapshot = createMockSnapshot({
        attachments: {} as any,
        embeds: [{} as any],
      });

      const forwardedFrom = createMockMessage();

      const result = formatter.formatSnapshot(snapshot, 1, forwardedFrom, GENERIC_MARKER);

      expect(result.attachments).toHaveLength(2);
      expect(result.attachments?.[0].url).toBe('https://example.com/file.pdf');
      expect(result.attachments?.[1].url).toBe('https://example.com/embed-image.png');
    });
  });

  describe('Embeds', () => {
    it('should format single embed', async () => {
      const snapshot = createMockSnapshot({
        embeds: [
          {
            title: 'Embed Title',
            description: 'Embed Description',
          } as APIEmbed,
        ],
      });

      const forwardedFrom = createMockMessage();

      const result = formatter.formatSnapshot(snapshot, 1, forwardedFrom, GENERIC_MARKER);

      expect(result.embeds).toBe('<embed>\nEmbed Title\nEmbed Description\n</embed>');
    });

    it('should format multiple embeds with numbers', async () => {
      const snapshot = createMockSnapshot({
        embeds: [
          {
            title: 'First Embed',
            description: 'First Description',
          } as APIEmbed,
          {
            title: 'Second Embed',
            description: 'Second Description',
          } as APIEmbed,
        ],
      });

      const forwardedFrom = createMockMessage();

      const result = formatter.formatSnapshot(snapshot, 1, forwardedFrom, GENERIC_MARKER);

      expect(result.embeds).toBe(
        '<embed number="1">\nFirst Embed\nFirst Description\n</embed>\n<embed number="2">\nSecond Embed\nSecond Description\n</embed>'
      );
    });

    it('should handle embeds with toJSON method', async () => {
      const snapshot = createMockSnapshot({
        embeds: [
          {
            toJSON: () =>
              ({
                title: 'JSON Embed',
                description: 'JSON Description',
              }) as APIEmbed,
          } as any,
        ],
      });

      const forwardedFrom = createMockMessage();

      const result = formatter.formatSnapshot(snapshot, 1, forwardedFrom, GENERIC_MARKER);

      expect(result.embeds).toBe('<embed>\nJSON Embed\nJSON Description\n</embed>');
    });

    it('should handle empty embeds array', async () => {
      const snapshot = createMockSnapshot({
        embeds: [],
      });

      const forwardedFrom = createMockMessage();

      const result = formatter.formatSnapshot(snapshot, 1, forwardedFrom, GENERIC_MARKER);

      expect(result.embeds).toBe('');
    });

    it('should handle null embeds', async () => {
      const snapshot = createMockSnapshot({
        embeds: null as any,
      });

      const forwardedFrom = createMockMessage();

      const result = formatter.formatSnapshot(snapshot, 1, forwardedFrom, GENERIC_MARKER);

      expect(result.embeds).toBe('');
    });
  });

  describe('Location Context', () => {
    /**
     * Builds a mock origin channel with the shape `buildForwardMarker`'s gate
     * needs: `isTextBased`/`isDMBased` (Channel narrowing),
     * `permissionsFor` (ViewChannel), and `isThread` (the entry point
     * `satisfiesPrivateThreadMembership` always calls first, even on the
     * non-thread happy path).
     */
    function createMockOriginChannel(
      overrides: {
        name?: string;
        isDM?: boolean;
        isThread?: boolean;
        isPrivateThread?: boolean;
        permissionsForResult?: { has: (flag: bigint) => boolean } | null;
        threadMembersFetch?: ReturnType<typeof vi.fn>;
      } = {}
    ): Channel {
      return {
        name: overrides.name ?? 'announcements',
        isTextBased: () => true,
        isDMBased: () => overrides.isDM ?? false,
        isThread: () => overrides.isThread ?? false,
        type:
          overrides.isPrivateThread === true ? ChannelType.PrivateThread : ChannelType.GuildText,
        // `??` alone can't distinguish "not provided" from an intentional
        // `null` override (the uncached-member fixture) — both are nullish.
        permissionsFor: vi.fn(() =>
          'permissionsForResult' in overrides
            ? overrides.permissionsForResult
            : { has: (flag: bigint) => flag === PermissionFlagsBits.ViewChannel }
        ),
        members: {
          fetch: overrides.threadMembersFetch ?? vi.fn(() => Promise.resolve({ id: 'member' })),
        },
      } as unknown as Channel;
    }

    /** The default forwarder id `createMockMessage()`'s author carries. */
    const DEFAULT_FORWARDER_ID = '123456789012345678';

    it('should append "(forwarded message)" to location context', async () => {
      const forwardedFrom = createMockMessage();

      const marker = await formatter.buildForwardMarker(forwardedFrom);

      expect(marker).toBe('(forwarded message)');
    });

    it('surfaces the origin channel name when the forwarder CAN view it', async () => {
      const forwardedFrom = createMockMessage({
        reference: { channelId: 'origin-chan-1' } as never,
        client: {
          channels: {
            cache: new Collection<string, Channel>([
              ['origin-chan-1', createMockOriginChannel({ name: 'announcements' })],
            ]),
          },
        } as never,
      });

      const marker = await formatter.buildForwardMarker(forwardedFrom);

      expect(marker).toBe('(forwarded from #announcements)');
    });

    it('degrades to the generic marker when the origin channel is not in cache (e.g. cross-server)', async () => {
      const forwardedFrom = createMockMessage({
        reference: { channelId: 'origin-chan-unknown' } as never,
        client: { channels: { cache: new Collection<string, Channel>() } } as never,
      });

      const marker = await formatter.buildForwardMarker(forwardedFrom);

      expect(marker).toBe('(forwarded message)');
    });

    it('degrades to the generic marker when the forwarder LACKS ViewChannel on the origin channel', async () => {
      // The behaviour change this task exists for: the bot can see the
      // channel (it's cached), but the FORWARDER cannot — so the name must
      // not leak.
      const forwardedFrom = createMockMessage({
        author: { id: DEFAULT_FORWARDER_ID } as never,
        reference: { channelId: 'origin-chan-private' } as never,
        client: {
          channels: {
            cache: new Collection<string, Channel>([
              [
                'origin-chan-private',
                createMockOriginChannel({
                  name: 'secret-channel',
                  permissionsForResult: { has: () => false },
                }),
              ],
            ]),
          },
        } as never,
      });

      const marker = await formatter.buildForwardMarker(forwardedFrom);

      expect(marker).toBe('(forwarded message)');
    });

    it('degrades to the generic marker when the forwarder cannot be resolved from cache (permissionsFor returns null)', async () => {
      const forwardedFrom = createMockMessage({
        author: { id: DEFAULT_FORWARDER_ID } as never,
        reference: { channelId: 'origin-chan-uncached' } as never,
        client: {
          channels: {
            cache: new Collection<string, Channel>([
              [
                'origin-chan-uncached',
                createMockOriginChannel({ name: 'general', permissionsForResult: null }),
              ],
            ]),
          },
        } as never,
      });

      const marker = await formatter.buildForwardMarker(forwardedFrom);

      expect(marker).toBe('(forwarded message)');
    });

    it('degrades to the generic marker for a DM origin channel', async () => {
      const forwardedFrom = createMockMessage({
        author: { id: DEFAULT_FORWARDER_ID } as never,
        reference: { channelId: 'origin-dm-1' } as never,
        client: {
          channels: {
            cache: new Collection<string, Channel>([
              ['origin-dm-1', createMockOriginChannel({ isDM: true })],
            ]),
          },
        } as never,
      });

      const marker = await formatter.buildForwardMarker(forwardedFrom);

      expect(marker).toBe('(forwarded message)');
    });

    it('degrades to the generic marker for a private thread the forwarder is NOT a member of', async () => {
      const forwardedFrom = createMockMessage({
        author: { id: DEFAULT_FORWARDER_ID } as never,
        reference: { channelId: 'origin-thread-1' } as never,
        client: {
          channels: {
            cache: new Collection<string, Channel>([
              [
                'origin-thread-1',
                createMockOriginChannel({
                  name: 'private-planning',
                  isThread: true,
                  isPrivateThread: true,
                  // Parent ViewChannel still granted — private threads carry
                  // an explicit member list on top of that.
                  threadMembersFetch: vi.fn(() => Promise.reject(new Error('Unknown Member'))),
                }),
              ],
            ]),
          },
        } as never,
      });

      const marker = await formatter.buildForwardMarker(forwardedFrom);

      expect(marker).toBe('(forwarded message)');
    });

    it('degrades to the generic marker for a cached but NON-text-based channel', async () => {
      // Distinct from the not-in-cache case: that one short-circuits on
      // `undefined` without ever invoking `isTextBased()`. This one has a real
      // object in the cache whose `isTextBased()` returns false, so it pins the
      // guard actually running rather than the optional chain absorbing it.
      const forwardedFrom = createMockMessage({
        author: { id: DEFAULT_FORWARDER_ID } as never,
        reference: { channelId: 'origin-voice-1' } as never,
        client: {
          channels: {
            cache: new Collection<string, Channel>([
              [
                'origin-voice-1',
                {
                  ...createMockOriginChannel({ name: 'stage-room' }),
                  isTextBased: () => false,
                } as unknown as Channel,
              ],
            ]),
          },
        } as never,
      });

      const marker = await formatter.buildForwardMarker(forwardedFrom);

      expect(marker).toBe('(forwarded message)');
    });

    it('gates on the FORWARDER id, not the bot — asserted at both access seams', async () => {
      // Every other test here mocks `permissionsFor`/`members.fetch` to ignore
      // their argument, so a gate that checked the BOT's access instead of the
      // forwarder's would satisfy all of them while defeating the entire point
      // of the check. These two assertions are what distinguish the cases.
      const forwarderId = '999888777666555444';
      const permissionsFor = vi.fn(() => ({ has: () => true }));
      const membersFetch = vi.fn(() => Promise.resolve({ id: forwarderId }));
      const forwardedFrom = createMockMessage({
        author: { id: forwarderId } as never,
        reference: { channelId: 'origin-thread-2' } as never,
        client: {
          channels: {
            cache: new Collection<string, Channel>([
              [
                'origin-thread-2',
                {
                  ...createMockOriginChannel({
                    name: 'planning',
                    isThread: true,
                    isPrivateThread: true,
                  }),
                  permissionsFor,
                  members: { fetch: membersFetch },
                } as unknown as Channel,
              ],
            ]),
          },
        } as never,
      });

      const marker = await formatter.buildForwardMarker(forwardedFrom);

      expect(permissionsFor).toHaveBeenCalledWith(forwarderId);
      expect(membersFetch).toHaveBeenCalledWith(forwarderId);
      expect(marker).toBe('(forwarded from #planning)');
    });
  });

  describe('Author Information', () => {
    it('should always use "Unknown User" for author fields', async () => {
      const snapshot = createMockSnapshot();
      const forwardedFrom = createMockMessage();

      const result = formatter.formatSnapshot(snapshot, 1, forwardedFrom, GENERIC_MARKER);

      expect(result.authorUsername).toBe('Unknown User');
      expect(result.authorDisplayName).toBe('Unknown User');
      expect(result.discordUserId).toBe('unknown');
    });

    it('should not include webhook ID', async () => {
      const snapshot = createMockSnapshot();
      const forwardedFrom = createMockMessage();

      const result = formatter.formatSnapshot(snapshot, 1, forwardedFrom, GENERIC_MARKER);

      expect(result.webhookId).toBeUndefined();
    });
  });
});
