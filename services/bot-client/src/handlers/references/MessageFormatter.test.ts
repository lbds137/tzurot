/**
 * Tests for MessageFormatter
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageFormatter } from './MessageFormatter.js';
import { createMockMessage, createMockUser } from '../../test/mocks/Discord.mock.js';
import type { TranscriptRetriever } from './TranscriptRetriever.js';

// Mock the utility functions
vi.mock('../../utils/discordContext.js', () => ({
  extractDiscordEnvironment: vi.fn().mockReturnValue({
    type: 'guild',
    guild: { id: 'guild-123', name: 'Test Guild' },
    channel: { id: 'channel-456', name: 'general', type: 'text' },
  }),
}));

// Mock the shared location formatter from common-types
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
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

describe('MessageFormatter', () => {
  let formatter: MessageFormatter;
  let mockTranscriptRetriever: TranscriptRetriever;

  beforeEach(() => {
    vi.clearAllMocks();

    mockTranscriptRetriever = {
      retrieveTranscript: vi.fn().mockResolvedValue(null),
    } as any;

    formatter = new MessageFormatter(mockTranscriptRetriever);
  });

  describe('Basic Formatting', () => {
    it('should format a simple message', async () => {
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

      const result = await formatter.formatMessage(message, 1);

      expect(result).toEqual({
        referenceNumber: 1,
        discordMessageId: 'msg-123',
        webhookId: undefined,
        discordUserId: 'user-456',
        authorUsername: 'TestUser',
        authorDisplayName: 'TestUser', // Mock uses username when displayName not explicitly set
        content: 'Hello world',
        embeds: [],
        timestamp: '2025-01-01T12:00:00.000Z',
        locationContext:
          '<location type="guild">\n<server name="Test Guild"/>\n<channel name="general" type="text"/>\n</location>',
        attachments: undefined,
        isForwarded: undefined,
      });
    });

    it('should include webhook ID if present', async () => {
      const message = createMockMessage({
        id: 'msg-123',
        content: 'Webhook message',
        webhookId: 'webhook-789',
        author: createMockUser({ username: 'WebhookUser' }),
        attachments: new Map() as any,
        embeds: [],
      });

      const result = await formatter.formatMessage(message, 1);

      expect(result.webhookId).toBe('webhook-789');
    });

    it('should mark message as forwarded when flag is set', async () => {
      const message = createMockMessage({
        content: 'Forwarded message',
        author: createMockUser(),
        attachments: new Map() as any,
        embeds: [],
      });

      const result = await formatter.formatMessage(message, 1, true);

      expect(result.isForwarded).toBe(true);
    });

    it('should use username as displayName when displayName is null', async () => {
      const message = createMockMessage({
        content: 'Test',
        author: createMockUser({ username: 'TestUser', globalName: null }),
        attachments: new Map() as any,
        embeds: [],
      });

      const result = await formatter.formatMessage(message, 1);

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
          filename: 'image.png',
        },
      ]);

      const message = createMockMessage({
        content: 'Check this image',
        author: createMockUser(),
        attachments: new Map() as any,
        embeds: [],
      });

      const result = await formatter.formatMessage(message, 1);

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
          filename: 'file.pdf',
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

      const result = await formatter.formatMessage(message, 1);

      expect(result.attachments).toHaveLength(2);
      expect(result.attachments?.[0].url).toBe('https://example.com/file.pdf');
      expect(result.attachments?.[1].url).toBe('https://example.com/embed-image.png');
    });
  });

  describe('Voice Transcript Handling', () => {
    it('should retrieve and append voice transcript when available', async () => {
      const { extractAttachments } = await import('../../utils/attachmentExtractor.js');

      vi.mocked(extractAttachments).mockReturnValue([
        {
          url: 'https://example.com/voice.ogg',
          contentType: 'audio/ogg',
          filename: 'voice.ogg',
          isVoiceMessage: true,
        },
      ]);

      vi.mocked(mockTranscriptRetriever.retrieveTranscript).mockResolvedValue(
        'This is the voice transcript'
      );

      const message = createMockMessage({
        id: 'msg-voice',
        content: 'Original text',
        author: createMockUser(),
        attachments: new Map() as any,
        embeds: [],
      });

      const result = await formatter.formatMessage(message, 1);

      expect(result.content).toBe(
        'Original text\n\n[Voice transcript]: This is the voice transcript'
      );
      expect(mockTranscriptRetriever.retrieveTranscript).toHaveBeenCalledWith(
        'msg-voice',
        'https://example.com/voice.ogg'
      );
    });

    it('should handle voice message with no text content', async () => {
      const { extractAttachments } = await import('../../utils/attachmentExtractor.js');

      vi.mocked(extractAttachments).mockReturnValue([
        {
          url: 'https://example.com/voice.ogg',
          contentType: 'audio/ogg',
          filename: 'voice.ogg',
          isVoiceMessage: true,
        },
      ]);

      vi.mocked(mockTranscriptRetriever.retrieveTranscript).mockResolvedValue(
        'Voice only transcript'
      );

      const message = createMockMessage({
        id: 'msg-voice',
        content: '',
        author: createMockUser(),
        attachments: new Map() as any,
        embeds: [],
      });

      const result = await formatter.formatMessage(message, 1);

      expect(result.content).toBe('[Voice transcript]: Voice only transcript');
    });

    it('should handle multiple voice messages', async () => {
      const { extractAttachments } = await import('../../utils/attachmentExtractor.js');

      vi.mocked(extractAttachments).mockReturnValue([
        {
          url: 'https://example.com/voice1.ogg',
          contentType: 'audio/ogg',
          filename: 'voice1.ogg',
          isVoiceMessage: true,
        },
        {
          url: 'https://example.com/voice2.ogg',
          contentType: 'audio/ogg',
          filename: 'voice2.ogg',
          isVoiceMessage: true,
        },
      ]);

      vi.mocked(mockTranscriptRetriever.retrieveTranscript)
        .mockResolvedValueOnce('First transcript')
        .mockResolvedValueOnce('Second transcript');

      const message = createMockMessage({
        id: 'msg-voice',
        content: 'Text content',
        author: createMockUser(),
        attachments: new Map() as any,
        embeds: [],
      });

      const result = await formatter.formatMessage(message, 1);

      expect(result.content).toBe(
        'Text content\n\n[Voice transcript]: First transcript\n\nSecond transcript'
      );
    });

    it('should skip voice attachments when transcript is unavailable', async () => {
      const { extractAttachments } = await import('../../utils/attachmentExtractor.js');

      vi.mocked(extractAttachments).mockReturnValue([
        {
          url: 'https://example.com/voice.ogg',
          contentType: 'audio/ogg',
          filename: 'voice.ogg',
          isVoiceMessage: true,
        },
      ]);

      vi.mocked(mockTranscriptRetriever.retrieveTranscript).mockResolvedValue(null);

      const message = createMockMessage({
        content: 'Original content',
        author: createMockUser(),
        attachments: new Map() as any,
        embeds: [],
      });

      const result = await formatter.formatMessage(message, 1);

      // Content should remain unchanged
      expect(result.content).toBe('Original content');
    });

    it('should not retrieve transcripts for non-voice audio attachments', async () => {
      const { extractAttachments } = await import('../../utils/attachmentExtractor.js');

      vi.mocked(extractAttachments).mockReturnValue([
        {
          url: 'https://example.com/music.mp3',
          contentType: 'audio/mpeg',
          filename: 'music.mp3',
          isVoiceMessage: false, // Not a voice message
        },
      ]);

      const message = createMockMessage({
        content: 'Music file',
        author: createMockUser(),
        attachments: new Map() as any,
        embeds: [],
      });

      await formatter.formatMessage(message, 1);

      // Should not try to retrieve transcript
      expect(mockTranscriptRetriever.retrieveTranscript).not.toHaveBeenCalled();
    });
  });

  describe('Embeds', () => {
    it('should parse and include embeds', async () => {
      const { EmbedParser } = await import('../../utils/EmbedParser.js');

      vi.mocked(EmbedParser.parseMessageEmbeds).mockReturnValue([
        'Embed Title',
        'Embed Description',
      ]);

      const message = createMockMessage({
        content: 'Message with embeds',
        author: createMockUser(),
        attachments: new Map() as any,
        embeds: [{} as any],
      });

      const result = await formatter.formatMessage(message, 1);

      expect(result.embeds).toEqual(['Embed Title', 'Embed Description']);
    });
  });
});
