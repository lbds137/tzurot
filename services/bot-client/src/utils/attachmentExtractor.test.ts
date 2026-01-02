/**
 * Attachment Extractor Tests
 *
 * Tests for extracting attachment metadata from Discord messages.
 */

import { describe, it, expect } from 'vitest';
import { Collection } from 'discord.js';
import type { Attachment, Snowflake } from 'discord.js';
import { extractAttachments } from './attachmentExtractor.js';
import { CONTENT_TYPES } from '@tzurot/common-types';

// Helper to create mock Attachment
function createMockAttachment(
  id: string,
  overrides?: Partial<{
    url: string;
    contentType: string | null;
    name: string;
    size: number;
    duration: number | null;
    waveform: string | null;
  }>
): Attachment {
  return {
    id,
    url: overrides?.url ?? `https://cdn.discord.com/attachments/123/${id}/file.txt`,
    // Use 'contentType' in overrides check to allow explicit null
    contentType: overrides && 'contentType' in overrides ? overrides.contentType : 'text/plain',
    name: overrides?.name ?? 'file.txt',
    size: overrides?.size ?? 1024,
    duration: overrides?.duration ?? null,
    waveform: overrides?.waveform ?? null,
  } as Attachment;
}

// Helper to create collection of attachments
function createAttachmentCollection(attachments: Attachment[]): Collection<Snowflake, Attachment> {
  const collection = new Collection<Snowflake, Attachment>();
  for (const attachment of attachments) {
    collection.set(attachment.id, attachment);
  }
  return collection;
}

describe('extractAttachments', () => {
  describe('empty attachments', () => {
    it('should return undefined for empty collection', () => {
      const collection = createAttachmentCollection([]);

      const result = extractAttachments(collection);

      expect(result).toBeUndefined();
    });
  });

  describe('single attachment', () => {
    it('should extract metadata from single attachment', () => {
      const attachment = createMockAttachment('123', {
        url: 'https://cdn.discord.com/attachments/guild/channel/123/image.png',
        contentType: 'image/png',
        name: 'image.png',
        size: 2048,
      });
      const collection = createAttachmentCollection([attachment]);

      const result = extractAttachments(collection);

      expect(result).toBeDefined();
      expect(result).toHaveLength(1);
      expect(result![0]).toEqual({
        id: '123',
        url: 'https://cdn.discord.com/attachments/guild/channel/123/image.png',
        contentType: 'image/png',
        name: 'image.png',
        size: 2048,
        isVoiceMessage: false,
        duration: undefined,
        waveform: undefined,
      });
    });

    it('should use BINARY content type when contentType is null', () => {
      const attachment = createMockAttachment('123', {
        contentType: null,
        name: 'unknown-file',
      });
      const collection = createAttachmentCollection([attachment]);

      const result = extractAttachments(collection);

      expect(result![0].contentType).toBe(CONTENT_TYPES.BINARY);
    });
  });

  describe('multiple attachments', () => {
    it('should extract metadata from multiple attachments', () => {
      const attachment1 = createMockAttachment('1', {
        url: 'https://example.com/file1.png',
        contentType: 'image/png',
        name: 'file1.png',
        size: 1000,
      });
      const attachment2 = createMockAttachment('2', {
        url: 'https://example.com/file2.pdf',
        contentType: 'application/pdf',
        name: 'file2.pdf',
        size: 5000,
      });
      const attachment3 = createMockAttachment('3', {
        url: 'https://example.com/file3.mp3',
        contentType: 'audio/mpeg',
        name: 'file3.mp3',
        size: 3000,
      });
      const collection = createAttachmentCollection([attachment1, attachment2, attachment3]);

      const result = extractAttachments(collection);

      expect(result).toHaveLength(3);
      expect(result![0].name).toBe('file1.png');
      expect(result![1].name).toBe('file2.pdf');
      expect(result![2].name).toBe('file3.mp3');
    });

    it('should preserve order of attachments', () => {
      const attachments = ['a', 'b', 'c', 'd'].map((id, index) =>
        createMockAttachment(id, { name: `file${index}.txt` })
      );
      const collection = createAttachmentCollection(attachments);

      const result = extractAttachments(collection);

      expect(result!.map(a => a.name)).toEqual([
        'file0.txt',
        'file1.txt',
        'file2.txt',
        'file3.txt',
      ]);
    });
  });

  describe('voice message detection', () => {
    it('should detect voice message when duration is set', () => {
      const voiceAttachment = createMockAttachment('voice', {
        url: 'https://cdn.discord.com/voice.ogg',
        contentType: 'audio/ogg',
        name: 'voice-message.ogg',
        size: 50000,
        duration: 5.5,
        waveform: 'base64encodedwaveform',
      });
      const collection = createAttachmentCollection([voiceAttachment]);

      const result = extractAttachments(collection);

      expect(result![0].isVoiceMessage).toBe(true);
      expect(result![0].duration).toBe(5.5);
      expect(result![0].waveform).toBe('base64encodedwaveform');
    });

    it('should not mark as voice message when duration is null', () => {
      const regularAttachment = createMockAttachment('audio', {
        contentType: 'audio/mp3',
        name: 'music.mp3',
        duration: null,
      });
      const collection = createAttachmentCollection([regularAttachment]);

      const result = extractAttachments(collection);

      expect(result![0].isVoiceMessage).toBe(false);
      expect(result![0].duration).toBeUndefined();
    });

    it('should set duration to undefined when null', () => {
      const attachment = createMockAttachment('123', { duration: null });
      const collection = createAttachmentCollection([attachment]);

      const result = extractAttachments(collection);

      expect(result![0].duration).toBeUndefined();
    });

    it('should set waveform to undefined when null', () => {
      const attachment = createMockAttachment('123', { waveform: null });
      const collection = createAttachmentCollection([attachment]);

      const result = extractAttachments(collection);

      expect(result![0].waveform).toBeUndefined();
    });
  });

  describe('content type handling', () => {
    it.each([
      ['image/png', 'PNG image'],
      ['image/jpeg', 'JPEG image'],
      ['image/gif', 'GIF image'],
      ['video/mp4', 'MP4 video'],
      ['audio/ogg', 'OGG audio'],
      ['application/pdf', 'PDF document'],
      ['text/plain', 'Plain text'],
    ])('should preserve %s content type', (contentType, _description) => {
      const attachment = createMockAttachment('123', { contentType });
      const collection = createAttachmentCollection([attachment]);

      const result = extractAttachments(collection);

      expect(result![0].contentType).toBe(contentType);
    });
  });

  describe('mixed attachments', () => {
    it('should handle mix of regular and voice attachments', () => {
      const imageAttachment = createMockAttachment('img', {
        contentType: 'image/png',
        name: 'photo.png',
        duration: null,
      });
      const voiceAttachment = createMockAttachment('voice', {
        contentType: 'audio/ogg',
        name: 'voice.ogg',
        duration: 3.2,
        waveform: 'data',
      });
      const pdfAttachment = createMockAttachment('doc', {
        contentType: 'application/pdf',
        name: 'document.pdf',
        duration: null,
      });
      const collection = createAttachmentCollection([
        imageAttachment,
        voiceAttachment,
        pdfAttachment,
      ]);

      const result = extractAttachments(collection);

      expect(result).toHaveLength(3);

      expect(result![0].isVoiceMessage).toBe(false);
      expect(result![0].name).toBe('photo.png');

      expect(result![1].isVoiceMessage).toBe(true);
      expect(result![1].name).toBe('voice.ogg');
      expect(result![1].duration).toBe(3.2);

      expect(result![2].isVoiceMessage).toBe(false);
      expect(result![2].name).toBe('document.pdf');
    });
  });

  describe('edge cases', () => {
    it('should handle attachment with zero size', () => {
      const attachment = createMockAttachment('123', { size: 0 });
      const collection = createAttachmentCollection([attachment]);

      const result = extractAttachments(collection);

      expect(result![0].size).toBe(0);
    });

    it('should handle attachment with very large size', () => {
      const attachment = createMockAttachment('123', { size: 1_000_000_000 });
      const collection = createAttachmentCollection([attachment]);

      const result = extractAttachments(collection);

      expect(result![0].size).toBe(1_000_000_000);
    });

    it('should handle empty filename', () => {
      const attachment = createMockAttachment('123', { name: '' });
      const collection = createAttachmentCollection([attachment]);

      const result = extractAttachments(collection);

      expect(result![0].name).toBe('');
    });

    it('should handle filename with special characters', () => {
      const attachment = createMockAttachment('123', {
        name: 'file name with spaces & special!@#$%.txt',
      });
      const collection = createAttachmentCollection([attachment]);

      const result = extractAttachments(collection);

      expect(result![0].name).toBe('file name with spaces & special!@#$%.txt');
    });

    it('should handle very long URLs', () => {
      const longUrl = 'https://cdn.discord.com/' + 'a'.repeat(1000);
      const attachment = createMockAttachment('123', { url: longUrl });
      const collection = createAttachmentCollection([attachment]);

      const result = extractAttachments(collection);

      expect(result![0].url).toBe(longUrl);
    });
  });
});
