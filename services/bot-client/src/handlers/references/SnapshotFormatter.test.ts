/**
 * Tests for SnapshotFormatter
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SnapshotFormatter } from './SnapshotFormatter.js';
import { createMockMessage } from '../../test/mocks/Discord.mock.js';
import type { MessageSnapshot, APIEmbed } from 'discord.js';

// Mock the utility functions
vi.mock('../../utils/discordContext.js', () => ({
  extractDiscordEnvironment: vi.fn().mockReturnValue({
    guildId: 'guild-123',
    guildName: 'Test Guild',
    channelId: 'channel-456',
    channelName: 'general',
  }),
}));

vi.mock('@tzurot/common-types', async importOriginal => {
  const original = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...original,
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
  let formatter: SnapshotFormatter;

  beforeEach(() => {
    vi.clearAllMocks();
    formatter = new SnapshotFormatter();
  });

  function createMockSnapshot(overrides: Partial<MessageSnapshot> = {}): MessageSnapshot {
    return {
      content: 'Snapshot content',
      createdTimestamp: 1704110400000, // 2024-01-01T12:00:00Z
      attachments: null,
      embeds: [],
      ...overrides,
    } as MessageSnapshot;
  }

  describe('Basic Formatting', () => {
    it('should format a simple snapshot', () => {
      const snapshot = createMockSnapshot({
        content: 'Forwarded message content',
        createdTimestamp: 1704110400000,
      });

      const forwardedFrom = createMockMessage({
        id: 'forward-msg-123',
        createdAt: new Date('2025-01-01T14:00:00Z'),
      });

      const result = formatter.formatSnapshot(snapshot, 1, forwardedFrom);

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

    it('should handle empty content', () => {
      const snapshot = createMockSnapshot({
        content: null as any,
      });

      const forwardedFrom = createMockMessage();

      const result = formatter.formatSnapshot(snapshot, 1, forwardedFrom);

      expect(result.content).toBe('');
    });

    it('should use forwardedFrom timestamp when snapshot has no timestamp', () => {
      const snapshot = createMockSnapshot({
        createdTimestamp: null as any,
      });

      const forwardedFrom = createMockMessage({
        createdAt: new Date('2025-01-01T15:00:00Z'),
      });

      const result = formatter.formatSnapshot(snapshot, 1, forwardedFrom);

      expect(result.timestamp).toBe('2025-01-01T15:00:00.000Z');
    });

    it('should always mark as forwarded', () => {
      const snapshot = createMockSnapshot();
      const forwardedFrom = createMockMessage();

      const result = formatter.formatSnapshot(snapshot, 5, forwardedFrom);

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
          filename: 'image.png',
        },
      ]);

      const snapshot = createMockSnapshot({
        attachments: {} as any,
      });

      const forwardedFrom = createMockMessage();

      const result = formatter.formatSnapshot(snapshot, 1, forwardedFrom);

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments?.[0].url).toBe('https://example.com/image.png');
    });

    it('should handle null attachments', () => {
      const snapshot = createMockSnapshot({
        attachments: null,
      });

      const forwardedFrom = createMockMessage();

      const result = formatter.formatSnapshot(snapshot, 1, forwardedFrom);

      expect(result.attachments).toBeUndefined();
    });

    it('should combine regular attachments and embed images', async () => {
      const { extractAttachments } = await import('../../utils/attachmentExtractor.js');
      const { extractEmbedImages } = await import('../../utils/embedImageExtractor.js');

      vi.mocked(extractAttachments).mockReturnValue([
        {
          url: 'https://example.com/file.pdf',
          contentType: 'application/pdf',
          filename: 'file.pdf',
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

      const result = formatter.formatSnapshot(snapshot, 1, forwardedFrom);

      expect(result.attachments).toHaveLength(2);
      expect(result.attachments?.[0].url).toBe('https://example.com/file.pdf');
      expect(result.attachments?.[1].url).toBe('https://example.com/embed-image.png');
    });
  });

  describe('Embeds', () => {
    it('should format single embed', () => {
      const snapshot = createMockSnapshot({
        embeds: [
          {
            title: 'Embed Title',
            description: 'Embed Description',
          } as APIEmbed,
        ],
      });

      const forwardedFrom = createMockMessage();

      const result = formatter.formatSnapshot(snapshot, 1, forwardedFrom);

      expect(result.embeds).toBe('<embed>\nEmbed Title\nEmbed Description\n</embed>');
    });

    it('should format multiple embeds with numbers', () => {
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

      const result = formatter.formatSnapshot(snapshot, 1, forwardedFrom);

      expect(result.embeds).toBe(
        '<embed number="1">\nFirst Embed\nFirst Description\n</embed>\n<embed number="2">\nSecond Embed\nSecond Description\n</embed>'
      );
    });

    it('should handle embeds with toJSON method', () => {
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

      const result = formatter.formatSnapshot(snapshot, 1, forwardedFrom);

      expect(result.embeds).toBe('<embed>\nJSON Embed\nJSON Description\n</embed>');
    });

    it('should handle empty embeds array', () => {
      const snapshot = createMockSnapshot({
        embeds: [],
      });

      const forwardedFrom = createMockMessage();

      const result = formatter.formatSnapshot(snapshot, 1, forwardedFrom);

      expect(result.embeds).toBe('');
    });

    it('should handle null embeds', () => {
      const snapshot = createMockSnapshot({
        embeds: null as any,
      });

      const forwardedFrom = createMockMessage();

      const result = formatter.formatSnapshot(snapshot, 1, forwardedFrom);

      expect(result.embeds).toBe('');
    });
  });

  describe('Location Context', () => {
    it('should append "(forwarded message)" to location context', () => {
      const snapshot = createMockSnapshot();
      const forwardedFrom = createMockMessage();

      const result = formatter.formatSnapshot(snapshot, 1, forwardedFrom);

      expect(result.locationContext).toBe(
        '<location type="guild"><server name="Test Guild"/></location> (forwarded message)'
      );
    });
  });

  describe('Author Information', () => {
    it('should always use "Unknown User" for author fields', () => {
      const snapshot = createMockSnapshot();
      const forwardedFrom = createMockMessage();

      const result = formatter.formatSnapshot(snapshot, 1, forwardedFrom);

      expect(result.authorUsername).toBe('Unknown User');
      expect(result.authorDisplayName).toBe('Unknown User');
      expect(result.discordUserId).toBe('unknown');
    });

    it('should not include webhook ID', () => {
      const snapshot = createMockSnapshot();
      const forwardedFrom = createMockMessage();

      const result = formatter.formatSnapshot(snapshot, 1, forwardedFrom);

      expect(result.webhookId).toBeUndefined();
    });
  });
});
