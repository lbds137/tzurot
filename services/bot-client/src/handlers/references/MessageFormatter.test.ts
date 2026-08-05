/**
 * Tests for MessageFormatter
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageFormatter } from './MessageFormatter.js';
import { createMockMessage, createMockUser } from '../../test/mocks/Discord.mock.js';

// Mock the utility functions
vi.mock('../../utils/discordContext.js', () => ({
  extractDiscordEnvironment: vi.fn().mockReturnValue({
    type: 'guild',
    guild: { id: 'guild-123', name: 'Test Guild' },
    channel: { id: 'channel-456', name: 'general', type: 'text' },
  }),
}));

// Mock the shared location formatter from common-types
vi.mock('@tzurot/common-types/utils/environmentFormatter', async () => {
  const actual = await vi.importActual<
    typeof import('@tzurot/common-types/utils/environmentFormatter')
  >('@tzurot/common-types/utils/environmentFormatter');
  return {
    ...actual,
    formatLocationAsXml: vi
      .fn()
      .mockReturnValue(
        '<location type="guild">\n<server name="Test Guild"/>\n<channel name="general" type="text"/>\n</location>'
      ),
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
    parseMessageEmbeds: vi.fn().mockReturnValue([]),
  },
}));

// Mock forwarded message utilities
vi.mock('../../utils/forwardedMessageUtils.js', () => ({
  isForwardedMessage: vi.fn().mockReturnValue(false),
  hasForwardedSnapshots: vi.fn().mockReturnValue(false),
  extractForwardedAttachments: vi.fn().mockReturnValue([]),
  extractForwardedContent: vi.fn().mockReturnValue(''),
}));

describe('MessageFormatter', () => {
  let formatter: MessageFormatter;

  beforeEach(() => {
    vi.clearAllMocks();

    formatter = new MessageFormatter();
  });

  describe('Basic Formatting', () => {
    it('should format a simple message', () => {
      const message = createMockMessage({
        id: 'msg-123',
        content: 'Hello world',
        author: createMockUser({
          id: 'user-456',
          username: 'TestUser',
          globalName: 'Test User',
        }),
        createdAt: new Date('2025-01-01T12:00:00Z'),
        webhookId: null,
        attachments: new Map() as any,
        embeds: [],
      });

      const result = formatter.buildRawReference(message, 1).reference;

      expect(result).toEqual({
        referenceNumber: 1,
        discordMessageId: 'msg-123',
        webhookId: undefined,
        discordUserId: 'user-456',
        authorUsername: 'TestUser',
        authorDisplayName: 'TestUser', // Mock uses username when displayName not explicitly set
        authorRole: 'user', // human author (no webhook, not a bot) → user
        content: 'Hello world',
        embeds: [],
        timestamp: '2025-01-01T12:00:00.000Z',
        locationContext:
          '<location type="guild">\n<server name="Test Guild"/>\n<channel name="general" type="text"/>\n</location>',
        attachments: undefined,
        isForwarded: undefined,
      });
    });

    it('should include webhook ID if present', () => {
      const message = createMockMessage({
        id: 'msg-123',
        content: 'Webhook message',
        webhookId: 'webhook-789',
        author: createMockUser({ username: 'WebhookUser' }),
        attachments: new Map() as any,
        embeds: [],
      });

      const result = formatter.buildRawReference(message, 1).reference;

      expect(result.webhookId).toBe('webhook-789');
    });

    it('should describe a sticker-only referenced message instead of rendering it blank', () => {
      const stickers = new Map([['1', { name: 'partyblob', description: null }]]);
      const message = createMockMessage({
        content: '',
        author: createMockUser(),
        attachments: new Map() as any,
        embeds: [],
        stickers: stickers as any,
      });

      const result = formatter.buildRawReference(message, 1).reference;

      expect(result.content).toBe('[Stickers: partyblob]');
    });

    it('should attach a referenced sticker so vision can describe it, not just name it', () => {
      // The name line above is only half. Without the sticker reaching
      // `attachments`, a character replying to a sticker saw what it was CALLED
      // and never what it depicted — while the same sticker sent directly was
      // described. This is the wiring, not the conversion (that is unit-tested
      // in stickerAttachments.test.ts); it fails if the call site is dropped.
      const stickers = new Map([
        [
          '99',
          {
            id: '99',
            name: 'partyblob',
            description: null,
            format: 1, // StickerFormatType.PNG
            url: 'https://cdn.discordapp.com/stickers/99.png',
          },
        ],
      ]);
      const message = createMockMessage({
        content: '',
        author: createMockUser(),
        attachments: new Map() as any,
        embeds: [],
        stickers: stickers as any,
      });

      const result = formatter.buildRawReference(message, 1).reference;

      expect(result.attachments).toEqual([
        expect.objectContaining({ id: '99', isSticker: true, contentType: 'image/png' }),
      ]);
    });

    it('should mark message as forwarded when flag is set', () => {
      const message = createMockMessage({
        content: 'Forwarded message',
        author: createMockUser(),
        attachments: new Map() as any,
        embeds: [],
      });

      const result = formatter.buildRawReference(message, 1, true).reference;

      expect(result.isForwarded).toBe(true);
    });

    it('should presence-encode authorIsBot for bot authors', () => {
      const message = createMockMessage({
        content: 'Bot message',
        author: createMockUser({ username: 'SomeBot', bot: true }),
        attachments: new Map() as any,
        embeds: [],
      });

      const result = formatter.buildRawReference(message, 1).reference;

      expect(result.authorIsBot).toBe(true);
    });

    it('should omit authorIsBot for human authors', () => {
      const message = createMockMessage({
        content: 'Human message',
        author: createMockUser({ username: 'Human', bot: false }),
        attachments: new Map() as any,
        embeds: [],
      });

      const result = formatter.buildRawReference(message, 1).reference;

      expect(result.authorIsBot).toBeUndefined();
    });

    it('stamps authorRole="assistant" for our own bot webhook (applicationId === client id)', () => {
      // Wiring check: applicationId matching the mock's client.user.id classifies as
      // our own persona. (Mock client.user.id is 'mock-client-bot-id'.)
      const message = createMockMessage({
        applicationId: 'mock-client-bot-id',
        webhookId: 'wh-self',
        author: createMockUser({ username: 'Lilith', bot: true }),
        attachments: new Map() as any,
        embeds: [],
      });

      const result = formatter.buildRawReference(message, 1).reference;

      expect(result.authorRole).toBe('assistant');
    });

    it('stamps authorRole="bot" for a non-persona webhook (different applicationId)', () => {
      const message = createMockMessage({
        applicationId: 'some-other-app',
        webhookId: 'wh-other',
        author: createMockUser({ username: 'MEE6', bot: true }),
        attachments: new Map() as any,
        embeds: [],
      });

      const result = formatter.buildRawReference(message, 1).reference;

      expect(result.authorRole).toBe('bot');
    });

    it('should use username as displayName when displayName is null', () => {
      const message = createMockMessage({
        content: 'Test',
        author: createMockUser({ username: 'TestUser', globalName: null }),
        attachments: new Map() as any,
        embeds: [],
      });

      const result = formatter.buildRawReference(message, 1).reference;

      expect(result.authorDisplayName).toBe('TestUser');
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

      const message = createMockMessage({
        content: 'Check this image',
        author: createMockUser(),
        attachments: new Map() as any,
        embeds: [],
      });

      const result = formatter.buildRawReference(message, 1).reference;

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments?.[0].url).toBe('https://example.com/image.png');
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

      const message = createMockMessage({
        content: 'Message with attachments',
        author: createMockUser(),
        attachments: new Map() as any,
        embeds: [{} as any],
      });

      const result = formatter.buildRawReference(message, 1).reference;

      expect(result.attachments).toHaveLength(2);
      expect(result.attachments?.[0].url).toBe('https://example.com/file.pdf');
      expect(result.attachments?.[1].url).toBe('https://example.com/embed-image.png');
    });
  });

  describe('Embeds', () => {
    it('should parse and include embeds', async () => {
      const { EmbedParser } = await import('../../utils/EmbedParser.js');

      vi.mocked(EmbedParser.parseMessageEmbeds).mockReturnValue('Embed Title\nEmbed Description');

      const message = createMockMessage({
        content: 'Message with embeds',
        author: createMockUser(),
        attachments: new Map() as any,
        embeds: [{} as any],
      });

      const result = formatter.buildRawReference(message, 1).reference;

      expect(result.embeds).toBe('Embed Title\nEmbed Description');
    });
  });

  describe('Forwarded Message Handling', () => {
    it('should extract voice attachments from forwarded message snapshots', async () => {
      // Setup forwarded message detection
      const {
        isForwardedMessage,
        hasForwardedSnapshots,
        extractForwardedAttachments,
        extractForwardedContent,
      } = await import('../../utils/forwardedMessageUtils.js');

      vi.mocked(isForwardedMessage).mockReturnValue(true);
      vi.mocked(hasForwardedSnapshots).mockReturnValue(true);
      vi.mocked(extractForwardedContent).mockReturnValue('Forwarded text content');
      vi.mocked(extractForwardedAttachments).mockReturnValue([
        {
          url: 'https://cdn.discord.com/voice.ogg',
          contentType: 'audio/ogg',
          name: 'voice.ogg',
          isVoiceMessage: true,
          duration: 5.5,
        },
      ]);

      const message = createMockMessage({
        id: 'forwarding-msg-999', // The forwarding message's ID
        content: '', // Forwarded messages often have empty main content
        author: createMockUser(),
        attachments: new Map() as any,
        embeds: [],
      });

      const result = formatter.buildRawReference(message, 1).reference;

      // Should be marked as forwarded
      expect(result.isForwarded).toBe(true);

      // Content comes from the snapshot, unenriched — the worker appends the
      // transcript itself from the raw attachment record below.
      expect(result.content).toBe('Forwarded text content');

      // Voice attachment should be in attachments
      expect(result.attachments).toHaveLength(1);
      expect(result.attachments?.[0].isVoiceMessage).toBe(true);
    });

    it('should extract images from forwarded message snapshots', async () => {
      const {
        isForwardedMessage,
        hasForwardedSnapshots,
        extractForwardedAttachments,
        extractForwardedContent,
      } = await import('../../utils/forwardedMessageUtils.js');

      vi.mocked(isForwardedMessage).mockReturnValue(true);
      vi.mocked(hasForwardedSnapshots).mockReturnValue(true);
      vi.mocked(extractForwardedContent).mockReturnValue('Look at this image');
      vi.mocked(extractForwardedAttachments).mockReturnValue([
        {
          url: 'https://cdn.discord.com/forwarded-image.png',
          contentType: 'image/png',
          name: 'image.png',
        },
      ]);

      const message = createMockMessage({
        id: 'forwarding-image-msg',
        content: '',
        author: createMockUser(),
        attachments: new Map() as any,
        embeds: [],
      });

      const result = formatter.buildRawReference(message, 1).reference;

      // Should be marked as forwarded
      expect(result.isForwarded).toBe(true);

      // Should have extracted content
      expect(result.content).toBe('Look at this image');

      // Image attachment should be extracted from snapshot
      expect(result.attachments).toHaveLength(1);
      expect(result.attachments?.[0].url).toBe('https://cdn.discord.com/forwarded-image.png');
      expect(result.attachments?.[0].contentType).toBe('image/png');
    });

    it('should fall back to regular attachment extraction when forwarded message has no snapshots', async () => {
      const { extractAttachments } = await import('../../utils/attachmentExtractor.js');
      const { extractEmbedImages } = await import('../../utils/embedImageExtractor.js');
      const {
        isForwardedMessage,
        hasForwardedSnapshots,
        extractForwardedAttachments,
        extractForwardedContent,
      } = await import('../../utils/forwardedMessageUtils.js');

      // Forwarded but no snapshots (Discord API edge case)
      vi.mocked(isForwardedMessage).mockReturnValue(true);
      vi.mocked(hasForwardedSnapshots).mockReturnValue(false);
      vi.mocked(extractForwardedContent).mockReturnValue('');
      vi.mocked(extractForwardedAttachments).mockReturnValue([]);

      // Regular attachment extraction fallback
      vi.mocked(extractAttachments).mockReturnValue([
        {
          url: 'https://example.com/fallback-image.jpg',
          contentType: 'image/jpeg',
          name: 'fallback.jpg',
        },
      ]);
      // Reset embed images to empty for this test
      vi.mocked(extractEmbedImages).mockReturnValue([]);

      const message = createMockMessage({
        id: 'forwarding-no-snapshots',
        content: 'Fallback content from main message',
        author: createMockUser(),
        attachments: new Map() as any,
        embeds: [],
      });

      const result = formatter.buildRawReference(message, 1).reference;

      // Should still be marked as forwarded
      expect(result.isForwarded).toBe(true);

      // Content should come from main message
      expect(result.content).toBe('Fallback content from main message');

      // Should have fallen back to regular attachment extraction
      expect(result.attachments).toHaveLength(1);
      expect(result.attachments?.[0].url).toBe('https://example.com/fallback-image.jpg');
    });
  });
});
