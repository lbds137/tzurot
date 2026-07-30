/**
 * Tests for MessageContentBuilder
 *
 * This utility builds comprehensive text content from Discord messages,
 * ensuring consistency between extended context and referenced messages.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Collection, MessageType, MessageReferenceType, StickerFormatType } from 'discord.js';
import type { Message, Attachment, Embed, MessageSnapshot, Sticker } from 'discord.js';
import {
  buildMessageContent,
  formatAttachmentDescription,
  hasMessageContent,
} from './MessageContentBuilder.js';
import type { AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';

// Mock dependencies
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

// Helper to create mock attachments
function createMockAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 'attachment-1',
    url: 'https://cdn.discord.com/attachments/123/456/file.png',
    name: 'file.png',
    size: 1024,
    contentType: 'image/png',
    duration: null,
    waveform: null,
    ...overrides,
  } as Attachment;
}

// Helper to create mock embed
function createMockEmbed(overrides: Partial<Embed> = {}): Embed {
  return {
    title: 'Test Embed',
    description: 'Test description',
    url: null,
    timestamp: null,
    color: null,
    footer: null,
    image: null,
    thumbnail: null,
    author: null,
    fields: [],
    toJSON: () => ({
      title: overrides.title ?? 'Test Embed',
      description: overrides.description ?? 'Test description',
    }),
    ...overrides,
  } as unknown as Embed;
}

// Helper to create mock message - uses Record<string, unknown> for flexible test input
function createMockMessage(overrides: Record<string, unknown> = {}): Message {
  const attachments = new Collection<string, Attachment>();
  const embeds: Embed[] = [];
  const messageSnapshots = new Collection<string, MessageSnapshot>();

  return {
    id: 'msg-123',
    content: '',
    attachments,
    embeds,
    reference: null,
    messageSnapshots,
    // Always present on a real Message; a fixture omitting them is the
    // untyped-mock drift that `as unknown as Message` hides from the compiler.
    stickers: new Collection<string, Sticker>(),
    poll: null,
    type: MessageType.Default,
    ...overrides,
  } as unknown as Message;
}

describe('MessageContentBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildMessageContent', () => {
    it('should return text content for simple text message', async () => {
      const message = createMockMessage({ content: 'Hello world' });

      const result = await buildMessageContent(message);

      expect(result.content).toBe('Hello world');
      expect(result.attachments).toEqual([]);
      expect(result.hasVoiceMessage).toBe(false);
      expect(result.isForwarded).toBe(false);
    });

    it('should return empty content for empty message', async () => {
      const message = createMockMessage({ content: '' });

      const result = await buildMessageContent(message);

      expect(result.content).toBe('');
      expect(result.attachments).toEqual([]);
    });

    it('should describe a sticker-only message so it is not read as empty', async () => {
      const stickers = new Collection<string, Sticker>();
      stickers.set('1', { name: 'partyblob', description: null } as unknown as Sticker);
      const message = createMockMessage({ content: '', stickers });

      const result = await buildMessageContent(message);

      // Non-empty is the load-bearing part: convertMessage's
      // hasProcessableContent gate drops a message whose content is empty.
      expect(result.content).toBe('[Stickers: partyblob]');
    });

    it('should emit a rasterizable sticker as a synthetic attachment for the vision path', async () => {
      // The wiring seam. Every OTHER sticker fixture in this file omits
      // `format`, so isRasterizableSticker rejects them and extractStickerImages
      // returns undefined — meaning the `...(stickerImages ?? [])` spread into
      // allAttachments could be deleted outright and this suite would stay
      // green. This fixture is shaped like a real sticker precisely so that
      // can't happen.
      const stickers = new Collection<string, Sticker>();
      stickers.set('111222333444555666', {
        id: '111222333444555666',
        name: 'partyblob',
        description: null,
        format: StickerFormatType.PNG,
        url: 'https://cdn.discordapp.com/stickers/111222333444555666.png',
      } as unknown as Sticker);
      const message = createMockMessage({ content: '', stickers });

      const result = await buildMessageContent(message);

      const stickerAttachment = result.attachments.find(a => a.isSticker === true);
      expect(stickerAttachment).toBeDefined();
      expect(stickerAttachment?.id).toBe('111222333444555666');
      // The text line survives alongside it — the two are complementary, and
      // dropping the line would re-open the EmptyMessageFilter hole.
      expect(result.content).toBe('[Stickers: partyblob]');
    });

    it('should NOT emit a Lottie sticker as an attachment (no raster form exists)', async () => {
      const stickers = new Collection<string, Sticker>();
      stickers.set('7', {
        id: '7',
        name: 'wumpus-dance',
        description: 'Wumpus dancing',
        format: StickerFormatType.Lottie,
        url: 'https://cdn.discordapp.com/stickers/7.json',
      } as unknown as Sticker);
      const message = createMockMessage({ content: '', stickers });

      const result = await buildMessageContent(message);

      expect(result.attachments.some(a => a.isSticker === true)).toBe(false);
      // Still named, so the message is never empty and the character knows.
      expect(result.content).toBe('[Stickers: wumpus-dance — Wumpus dancing]');
    });

    it('should merge own and snapshot stickers when a forward also carries its own', async () => {
      const ownStickers = new Collection<string, Sticker>();
      ownStickers.set('1', { name: 'own', description: null } as unknown as Sticker);
      const snapshotStickers = new Collection<string, Sticker>();
      snapshotStickers.set('2', { name: 'forwarded', description: null } as unknown as Sticker);
      const messageSnapshots = new Collection<string, MessageSnapshot>();
      messageSnapshots.set('1', {
        content: 'forwarded body',
        embeds: [],
        attachments: new Collection(),
        stickers: snapshotStickers,
      } as unknown as MessageSnapshot);
      const message = createMockMessage({
        content: '',
        stickers: ownStickers,
        messageSnapshots,
        reference: { type: MessageReferenceType.Forward, messageId: 'src' },
      });

      const result = await buildMessageContent(message);

      expect(result.isForwarded).toBe(true);
      expect(result.content).toContain('[Stickers: own, forwarded]');
    });

    it('should describe a poll alongside the message text', async () => {
      const message = createMockMessage({
        content: 'vote now',
        poll: {
          question: { text: 'Pizza?' },
          answers: new Collection<number, unknown>([
            [0, { text: 'Yes', emoji: null }],
            [1, { text: 'No', emoji: null }],
          ]),
        },
      });

      const result = await buildMessageContent(message);

      expect(result.content).toBe('vote now\n\n[Poll: Pizza? — options: Yes, No]');
    });

    it('should include attachment descriptions when includeAttachments is true', async () => {
      const attachments = new Collection<string, Attachment>();
      attachments.set('1', createMockAttachment({ name: 'image.png', contentType: 'image/png' }));
      const message = createMockMessage({ content: 'Check this out', attachments });

      const result = await buildMessageContent(message, { includeAttachments: true });

      expect(result.content).toContain('Check this out');
      expect(result.content).toContain('[Attachments:');
      expect(result.content).toContain('image/png: image.png');
    });

    it('should not include attachment descriptions when includeAttachments is false', async () => {
      const attachments = new Collection<string, Attachment>();
      attachments.set('1', createMockAttachment({ name: 'image.png', contentType: 'image/png' }));
      const message = createMockMessage({ content: 'Check this out', attachments });

      const result = await buildMessageContent(message, { includeAttachments: false });

      expect(result.content).toBe('Check this out');
      expect(result.content).not.toContain('[Attachments:');
    });

    it('should include embed content when includeEmbeds is true', async () => {
      const embeds = [createMockEmbed({ title: 'My Embed', description: 'Embed content' })];
      const message = createMockMessage({ content: 'Check this embed', embeds });

      const result = await buildMessageContent(message, { includeEmbeds: true });

      expect(result.content).toContain('Check this embed');
      // Embeds are now returned separately for structured XML formatting
      expect(result.embedsXml).toBeDefined();
      expect(result.embedsXml![0]).toContain('<embed>');
    });

    it('should not include embed content when includeEmbeds is false', async () => {
      const embeds = [createMockEmbed({ title: 'My Embed', description: 'Embed content' })];
      const message = createMockMessage({ content: 'Check this embed', embeds });

      const result = await buildMessageContent(message, { includeEmbeds: false });

      expect(result.content).toBe('Check this embed');
      expect(result.content).not.toContain('<embed>');
    });

    it('should detect voice messages and set hasVoiceMessage flag', async () => {
      const attachments = new Collection<string, Attachment>();
      attachments.set(
        '1',
        createMockAttachment({
          name: 'voice-message.ogg',
          contentType: 'audio/ogg',
          duration: 5,
        })
      );
      const message = createMockMessage({ content: '', attachments });

      const result = await buildMessageContent(message);

      expect(result.hasVoiceMessage).toBe(true);
    });

    it('should use transcript retriever for voice messages when provided', async () => {
      const attachments = new Collection<string, Attachment>();
      attachments.set(
        '1',
        createMockAttachment({
          name: 'voice-message.ogg',
          contentType: 'audio/ogg',
          duration: 5,
        })
      );
      const message = createMockMessage({ content: '', attachments });
      const getTranscript = vi.fn().mockResolvedValue('Hello from voice message');

      const result = await buildMessageContent(message, { getTranscript });

      expect(getTranscript).toHaveBeenCalledWith('msg-123', expect.any(String));
      // Voice transcripts are now returned separately for structured XML formatting
      expect(result.voiceTranscripts).toBeDefined();
      expect(result.voiceTranscripts).toContain('Hello from voice message');
      expect(result.hasVoiceMessage).toBe(true);
    });

    it('should handle forwarded messages', async () => {
      const messageSnapshots = new Collection<string, MessageSnapshot>();
      messageSnapshots.set('1', {
        content: 'Original forwarded content',
        embeds: [],
        attachments: new Collection(),
        createdTimestamp: Date.now(),
      } as unknown as MessageSnapshot);

      const message = createMockMessage({
        content: '',
        reference: { type: MessageReferenceType.Forward } as Message['reference'],
        messageSnapshots,
      });

      const result = await buildMessageContent(message);

      expect(result.isForwarded).toBe(true);
      // Content no longer has [Forwarded message]: prefix - isForwarded flag is used for XML attribute
      expect(result.content).toContain('Original forwarded content');
      expect(result.content).not.toContain('[Forwarded message]:');
    });

    it('should extract attachments from forwarded message snapshots', async () => {
      // Create snapshot with attachments (critical for forwarded images!)
      const snapshotAttachments = new Collection<string, Attachment>();
      snapshotAttachments.set(
        'snap-attach-1',
        createMockAttachment({
          id: 'snap-attach-1',
          name: 'forwarded-image.jpg',
          contentType: 'image/jpeg',
          url: 'https://cdn.discord.com/attachments/123/789/forwarded-image.jpg',
        })
      );
      snapshotAttachments.set(
        'snap-attach-2',
        createMockAttachment({
          id: 'snap-attach-2',
          name: 'forwarded-doc.pdf',
          contentType: 'application/pdf',
          url: 'https://cdn.discord.com/attachments/123/790/forwarded-doc.pdf',
        })
      );

      const messageSnapshots = new Collection<string, MessageSnapshot>();
      messageSnapshots.set('1', {
        content: 'Check out these files',
        embeds: [],
        attachments: snapshotAttachments,
        createdTimestamp: Date.now(),
      } as unknown as MessageSnapshot);

      const message = createMockMessage({
        content: '',
        reference: { type: MessageReferenceType.Forward } as Message['reference'],
        messageSnapshots,
      });

      const result = await buildMessageContent(message);

      expect(result.isForwarded).toBe(true);
      expect(result.attachments).toHaveLength(2);
      expect(result.attachments[0].name).toBe('forwarded-image.jpg');
      expect(result.attachments[0].contentType).toBe('image/jpeg');
      expect(result.attachments[1].name).toBe('forwarded-doc.pdf');
    });

    it('should combine forwarded snapshot attachments with main message attachments', async () => {
      // Snapshot with image
      const snapshotAttachments = new Collection<string, Attachment>();
      snapshotAttachments.set(
        'snap-1',
        createMockAttachment({
          id: 'snap-1',
          name: 'from-snapshot.png',
          contentType: 'image/png',
        })
      );

      const messageSnapshots = new Collection<string, MessageSnapshot>();
      messageSnapshots.set('1', {
        content: 'Forwarded content',
        embeds: [],
        attachments: snapshotAttachments,
        createdTimestamp: Date.now(),
      } as unknown as MessageSnapshot);

      // Main message also has an attachment (rare but possible)
      const mainAttachments = new Collection<string, Attachment>();
      mainAttachments.set(
        'main-1',
        createMockAttachment({
          id: 'main-1',
          name: 'on-main-message.gif',
          contentType: 'image/gif',
        })
      );

      const message = createMockMessage({
        content: '',
        reference: { type: MessageReferenceType.Forward } as Message['reference'],
        messageSnapshots,
        attachments: mainAttachments,
      });

      const result = await buildMessageContent(message);

      // Should have both snapshot and main message attachments
      expect(result.attachments).toHaveLength(2);
      // Snapshot attachments come first
      expect(result.attachments[0].name).toBe('from-snapshot.png');
      expect(result.attachments[1].name).toBe('on-main-message.gif');
    });

    it('should use forwarding message ID for forwarded voice message transcript lookup', async () => {
      // Create forwarded voice message - the key is that getTranscript should be called
      // with the FORWARDING message's ID, not the original message ID.
      // This is because VoiceTranscriptionService stores transcripts keyed by the
      // message ID that triggered transcription (the forwarding message).
      const snapshotAttachments = new Collection<string, Attachment>();
      snapshotAttachments.set(
        'voice-1',
        createMockAttachment({
          id: 'voice-1',
          name: 'voice-message.ogg',
          contentType: 'audio/ogg',
          duration: 5.5, // Voice messages have duration
          url: 'https://cdn.discord.com/attachments/123/voice.ogg',
        })
      );

      const messageSnapshots = new Collection<string, MessageSnapshot>();
      messageSnapshots.set('1', {
        content: '',
        embeds: [],
        attachments: snapshotAttachments,
        createdTimestamp: Date.now(),
      } as unknown as MessageSnapshot);

      const message = createMockMessage({
        id: 'forwarded-msg-999', // The forwarding message's ID - this is used for lookup
        content: '',
        reference: {
          type: MessageReferenceType.Forward,
          messageId: 'original-voice-msg-123', // The ORIGINAL voice message ID (not used for lookup)
        } as Message['reference'],
        messageSnapshots,
      });

      const getTranscript = vi.fn().mockResolvedValue('Hello from the voice message');

      const result = await buildMessageContent(message, { getTranscript });

      // CRITICAL: getTranscript should be called with FORWARDING message ID
      // The transcript was stored under the forwarding message's ID when originally processed
      expect(getTranscript).toHaveBeenCalledWith(
        'forwarded-msg-999', // Forwarding message ID
        'https://cdn.discord.com/attachments/123/voice.ogg'
      );
      expect(getTranscript).not.toHaveBeenCalledWith('original-voice-msg-123', expect.any(String));

      // Voice transcripts are now returned separately for structured XML formatting
      expect(result.voiceTranscripts).toBeDefined();
      expect(result.voiceTranscripts).toContain('Hello from the voice message');
      expect(result.hasVoiceMessage).toBe(true);
      expect(result.isForwarded).toBe(true);
    });

    it('should handle forwarded voice message when no transcript is available', async () => {
      // Test the fallback path when getTranscript returns null
      const snapshotAttachments = new Collection<string, Attachment>();
      snapshotAttachments.set(
        'voice-1',
        createMockAttachment({
          id: 'voice-1',
          name: 'voice-message.ogg',
          contentType: 'audio/ogg',
          duration: 8.2,
          url: 'https://cdn.discord.com/attachments/123/voice-no-transcript.ogg',
        })
      );

      const messageSnapshots = new Collection<string, MessageSnapshot>();
      messageSnapshots.set('1', {
        content: '',
        embeds: [],
        attachments: snapshotAttachments,
        createdTimestamp: Date.now(),
      } as unknown as MessageSnapshot);

      const message = createMockMessage({
        id: 'forwarded-msg-no-transcript', // The forwarding message's ID - used for lookup
        content: '',
        reference: {
          type: MessageReferenceType.Forward,
          messageId: 'original-voice-msg-456', // Original message ID (not used for lookup)
        } as Message['reference'],
        messageSnapshots,
      });

      // Transcript not available (returns null)
      const getTranscript = vi.fn().mockResolvedValue(null);

      const result = await buildMessageContent(message, { getTranscript });

      // Should still attempt lookup using FORWARDING message ID
      expect(getTranscript).toHaveBeenCalledWith(
        'forwarded-msg-no-transcript', // Forwarding message ID
        'https://cdn.discord.com/attachments/123/voice-no-transcript.ogg'
      );

      // No transcript in content (since none was found)
      expect(result.content).not.toContain('[Voice transcript]');
      // Voice message attachment should be in the attachments list
      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0].isVoiceMessage).toBe(true);
      expect(result.hasVoiceMessage).toBe(true);
      expect(result.isForwarded).toBe(true);
    });

    it('should handle forwarded voice message when originalMessageId is undefined', async () => {
      // Edge case: forwarded message without reference.messageId
      // This can happen with certain Discord API edge cases.
      // The transcript lookup should STILL work using the forwarding message's ID.
      const snapshotAttachments = new Collection<string, Attachment>();
      snapshotAttachments.set(
        'voice-1',
        createMockAttachment({
          id: 'voice-1',
          name: 'voice-message.ogg',
          contentType: 'audio/ogg',
          duration: 3.5,
          url: 'https://cdn.discord.com/attachments/123/voice-no-ref.ogg',
        })
      );

      const messageSnapshots = new Collection<string, MessageSnapshot>();
      messageSnapshots.set('1', {
        content: '',
        embeds: [],
        attachments: snapshotAttachments,
        createdTimestamp: Date.now(),
      } as unknown as MessageSnapshot);

      const message = createMockMessage({
        id: 'forwarded-msg-no-ref', // The forwarding message's ID - used for lookup
        content: '',
        reference: {
          type: MessageReferenceType.Forward,
          // messageId is intentionally missing! But we don't need it anymore.
        } as Message['reference'],
        messageSnapshots,
      });

      const getTranscript = vi.fn().mockResolvedValue('Transcript found via forwarding message ID');

      const result = await buildMessageContent(message, { getTranscript });

      // getTranscript SHOULD be called using the FORWARDING message's ID
      // We don't need the original message ID for lookup since transcripts are
      // stored under the forwarding message's ID when VoiceTranscriptionService processes them
      expect(getTranscript).toHaveBeenCalledWith(
        'forwarded-msg-no-ref', // Forwarding message ID
        'https://cdn.discord.com/attachments/123/voice-no-ref.ogg'
      );

      // Voice message should be detected with transcript found
      expect(result.hasVoiceMessage).toBe(true);
      expect(result.isForwarded).toBe(true);
      // Voice transcripts are returned separately for structured XML formatting
      expect(result.voiceTranscripts).toBeDefined();
      expect(result.voiceTranscripts).toContain('Transcript found via forwarding message ID');
    });

    it('should combine text content with attachments and embeds', async () => {
      const attachments = new Collection<string, Attachment>();
      attachments.set('1', createMockAttachment({ name: 'photo.jpg', contentType: 'image/jpeg' }));
      const embeds = [createMockEmbed({ title: 'Link Preview', description: 'Preview text' })];
      const message = createMockMessage({
        content: 'Look at this!',
        attachments,
        embeds,
      });

      const result = await buildMessageContent(message);

      expect(result.content).toContain('Look at this!');
      expect(result.content).toContain('[Attachments:');
      // Embeds are now returned separately for structured XML formatting
      expect(result.embedsXml).toBeDefined();
      expect(result.embedsXml![0]).toContain('<embed>');
      expect(result.attachments.length).toBeGreaterThan(0);
    });
  });

  describe('formatAttachmentDescription', () => {
    it('should return empty string for undefined attachments', () => {
      const result = formatAttachmentDescription(undefined);
      expect(result).toBe('');
    });

    it('should return empty string for empty attachments array', () => {
      const result = formatAttachmentDescription([]);
      expect(result).toBe('');
    });

    it('should format regular attachments', () => {
      const attachments: AttachmentMetadata[] = [
        { url: 'http://example.com/file.png', contentType: 'image/png', name: 'file.png' },
        { url: 'http://example.com/doc.pdf', contentType: 'application/pdf', name: 'doc.pdf' },
      ];

      const result = formatAttachmentDescription(attachments);

      expect(result).toBe('[Attachments: [image/png: file.png], [application/pdf: doc.pdf]]');
    });

    it('should format voice message attachments with duration', () => {
      const attachments: AttachmentMetadata[] = [
        {
          url: 'http://example.com/voice.ogg',
          contentType: 'audio/ogg',
          name: 'voice-message.ogg',
          isVoiceMessage: true,
          duration: 10.5,
        },
      ];

      const result = formatAttachmentDescription(attachments);

      expect(result).toBe('[Attachments: [voice message: voice-message.ogg (11s)]]');
    });

    it('should format voice message without duration', () => {
      const attachments: AttachmentMetadata[] = [
        {
          url: 'http://example.com/voice.ogg',
          contentType: 'audio/ogg',
          name: 'voice-message.ogg',
          isVoiceMessage: true,
        },
      ];

      const result = formatAttachmentDescription(attachments);

      expect(result).toBe('[Attachments: [voice message: voice-message.ogg]]');
    });
  });

  describe('hasMessageContent', () => {
    it('should return true for message with text content', () => {
      const message = createMockMessage({ content: 'Hello' });
      expect(hasMessageContent(message)).toBe(true);
    });

    it('should return true for message with attachments', () => {
      const attachments = new Collection<string, Attachment>();
      attachments.set('1', createMockAttachment());
      const message = createMockMessage({ attachments });

      expect(hasMessageContent(message)).toBe(true);
    });

    it('should return true for message with embeds', () => {
      const embeds = [createMockEmbed()];
      const message = createMockMessage({ embeds });

      expect(hasMessageContent(message)).toBe(true);
    });

    it('should return true for forwarded message with snapshots', () => {
      const messageSnapshots = new Collection<string, MessageSnapshot>();
      messageSnapshots.set('1', { content: 'Forwarded' } as unknown as MessageSnapshot);
      const message = createMockMessage({ messageSnapshots });

      expect(hasMessageContent(message)).toBe(true);
    });

    it('should return false for empty message', () => {
      const message = createMockMessage({ content: '' });
      expect(hasMessageContent(message)).toBe(false);
    });
  });
});
