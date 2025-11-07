/**
 * Tests for attachment placeholder generation
 */

import { describe, it, expect } from 'vitest';
import {
  generateAttachmentPlaceholder,
  generateAttachmentPlaceholders,
} from './attachmentPlaceholders.js';
import type { AttachmentMetadata } from '@tzurot/common-types';

describe('attachmentPlaceholders', () => {
  describe('generateAttachmentPlaceholder', () => {
    it('should generate placeholder for voice message with duration', () => {
      const attachment: AttachmentMetadata = {
        url: 'https://example.com/voice.ogg',
        contentType: 'audio/ogg',
        name: 'voice.ogg',
        size: 50000,
        isVoiceMessage: true,
        duration: 5.2,
      };

      const result = generateAttachmentPlaceholder(attachment);

      expect(result).toBe('[Voice message: 5.2s]');
    });

    it('should generate placeholder for regular audio file', () => {
      const attachment: AttachmentMetadata = {
        url: 'https://example.com/song.mp3',
        contentType: 'audio/mp3',
        name: 'song.mp3',
        size: 3000000,
        isVoiceMessage: false,
      };

      const result = generateAttachmentPlaceholder(attachment);

      expect(result).toBe('[Audio: song.mp3]');
    });

    it('should generate placeholder for audio without filename', () => {
      const attachment: AttachmentMetadata = {
        url: 'https://example.com/audio',
        contentType: 'audio/ogg',
        size: 50000,
        isVoiceMessage: false,
      };

      const result = generateAttachmentPlaceholder(attachment);

      expect(result).toBe('[Audio: attachment]');
    });

    it('should generate placeholder for image with filename', () => {
      const attachment: AttachmentMetadata = {
        url: 'https://example.com/photo.jpg',
        contentType: 'image/jpeg',
        name: 'photo.jpg',
        size: 500000,
        isVoiceMessage: false,
      };

      const result = generateAttachmentPlaceholder(attachment);

      expect(result).toBe('[Image: photo.jpg]');
    });

    it('should generate placeholder for image without filename', () => {
      const attachment: AttachmentMetadata = {
        url: 'https://example.com/img',
        contentType: 'image/png',
        size: 300000,
        isVoiceMessage: false,
      };

      const result = generateAttachmentPlaceholder(attachment);

      expect(result).toBe('[Image: attachment]');
    });

    it('should generate placeholder for generic file', () => {
      const attachment: AttachmentMetadata = {
        url: 'https://example.com/document.pdf',
        contentType: 'application/pdf',
        name: 'document.pdf',
        size: 100000,
        isVoiceMessage: false,
      };

      const result = generateAttachmentPlaceholder(attachment);

      expect(result).toBe('[File: document.pdf]');
    });

    it('should handle voice message with rounded duration', () => {
      const attachment: AttachmentMetadata = {
        url: 'https://example.com/voice.ogg',
        contentType: 'audio/ogg',
        name: 'voice.ogg',
        size: 50000,
        isVoiceMessage: true,
        duration: 12.789,
      };

      const result = generateAttachmentPlaceholder(attachment);

      expect(result).toBe('[Voice message: 12.8s]');
    });

    it('should handle zero duration voice message', () => {
      const attachment: AttachmentMetadata = {
        url: 'https://example.com/voice.ogg',
        contentType: 'audio/ogg',
        name: 'voice.ogg',
        size: 50000,
        isVoiceMessage: true,
        duration: 0,
      };

      const result = generateAttachmentPlaceholder(attachment);

      expect(result).toBe('[Voice message: 0.0s]');
    });
  });

  describe('generateAttachmentPlaceholders', () => {
    it('should return empty string for no attachments', () => {
      const result = generateAttachmentPlaceholders([]);

      expect(result).toBe('');
    });

    it('should generate placeholders for single attachment', () => {
      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://example.com/photo.jpg',
          contentType: 'image/jpeg',
          name: 'photo.jpg',
          size: 500000,
          isVoiceMessage: false,
        },
      ];

      const result = generateAttachmentPlaceholders(attachments);

      expect(result).toBe('\n\n[Image: photo.jpg]');
    });

    it('should generate placeholders for multiple attachments', () => {
      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://example.com/photo.jpg',
          contentType: 'image/jpeg',
          name: 'photo.jpg',
          size: 500000,
          isVoiceMessage: false,
        },
        {
          url: 'https://example.com/voice.ogg',
          contentType: 'audio/ogg',
          name: 'voice.ogg',
          size: 50000,
          isVoiceMessage: true,
          duration: 5.2,
        },
        {
          url: 'https://example.com/document.pdf',
          contentType: 'application/pdf',
          name: 'document.pdf',
          size: 100000,
          isVoiceMessage: false,
        },
      ];

      const result = generateAttachmentPlaceholders(attachments);

      expect(result).toBe('\n\n[Image: photo.jpg] [Voice message: 5.2s] [File: document.pdf]');
    });

    it('should handle mixed attachment types', () => {
      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://example.com/voice1.ogg',
          contentType: 'audio/ogg',
          name: 'voice1.ogg',
          size: 50000,
          isVoiceMessage: true,
          duration: 3.5,
        },
        {
          url: 'https://example.com/image1.png',
          contentType: 'image/png',
          size: 300000,
          isVoiceMessage: false,
        },
        {
          url: 'https://example.com/voice2.ogg',
          contentType: 'audio/ogg',
          name: 'voice2.ogg',
          size: 75000,
          isVoiceMessage: true,
          duration: 8.1,
        },
      ];

      const result = generateAttachmentPlaceholders(attachments);

      expect(result).toBe(
        '\n\n[Voice message: 3.5s] [Image: attachment] [Voice message: 8.1s]'
      );
    });

    it('should format with newlines for appending to message', () => {
      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://example.com/photo.jpg',
          contentType: 'image/jpeg',
          name: 'photo.jpg',
          size: 500000,
          isVoiceMessage: false,
        },
      ];

      const messageContent = 'Check out this photo!';
      const result = messageContent + generateAttachmentPlaceholders(attachments);

      expect(result).toBe('Check out this photo!\n\n[Image: photo.jpg]');
    });
  });
});
