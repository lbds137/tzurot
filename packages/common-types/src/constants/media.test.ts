/**
 * Tests for media constants
 */

import { describe, it, expect } from 'vitest';
import {
  MEDIA_LIMITS,
  AVATAR_LIMITS,
  VOICE_REFERENCE_LIMITS,
  CONTENT_TYPES,
  EMBED_NAMING,
  AttachmentType,
} from './media.js';

describe('Media Constants', () => {
  describe('MEDIA_LIMITS', () => {
    it('should have correct image size limits', () => {
      expect(MEDIA_LIMITS.MAX_IMAGE_SIZE).toBe(10 * 1024 * 1024);
      expect(MEDIA_LIMITS.IMAGE_TARGET_SIZE).toBe(8 * 1024 * 1024);
      expect(MEDIA_LIMITS.IMAGE_QUALITY).toBe(85);
    });
  });

  describe('AVATAR_LIMITS', () => {
    it('should have correct avatar limits', () => {
      expect(AVATAR_LIMITS.TARGET_SIZE_KB).toBe(200);
      expect(AVATAR_LIMITS.MAX_DIMENSION).toBe(512);
    });
  });

  describe('VOICE_REFERENCE_LIMITS', () => {
    it('should have a 10MB max size', () => {
      expect(VOICE_REFERENCE_LIMITS.MAX_SIZE).toBe(10 * 1024 * 1024);
    });

    it('should allow wav, mpeg, ogg, flac, wav aliases, and mobile formats', () => {
      expect(VOICE_REFERENCE_LIMITS.ALLOWED_TYPES).toEqual([
        'audio/wav',
        'audio/mpeg',
        'audio/ogg',
        'audio/flac',
        'audio/x-wav',
        'audio/wave',
        'audio/mp4',
        'audio/x-m4a',
      ]);
    });

    it('should not allow non-audio types', () => {
      expect(VOICE_REFERENCE_LIMITS.ALLOWED_TYPES).not.toContain('image/png');
      expect(VOICE_REFERENCE_LIMITS.ALLOWED_TYPES).not.toContain('application/json');
    });
  });

  describe('CONTENT_TYPES', () => {
    it('should have image types', () => {
      expect(CONTENT_TYPES.IMAGE_PNG).toBe('image/png');
      expect(CONTENT_TYPES.IMAGE_JPG).toBe('image/jpeg');
      expect(CONTENT_TYPES.IMAGE_WEBP).toBe('image/webp');
    });

    it('should have audio types', () => {
      expect(CONTENT_TYPES.AUDIO_WAV).toBe('audio/wav');
      expect(CONTENT_TYPES.AUDIO_FLAC).toBe('audio/flac');
      expect(CONTENT_TYPES.AUDIO_OGG).toBe('audio/ogg');
      expect(CONTENT_TYPES.AUDIO_MP3).toBe('audio/mpeg');
    });

    it('should have prefixes', () => {
      expect(CONTENT_TYPES.IMAGE_PREFIX).toBe('image/');
      expect(CONTENT_TYPES.AUDIO_PREFIX).toBe('audio/');
    });
  });

  describe('AttachmentType', () => {
    it('should have Image and Audio values', () => {
      expect(AttachmentType.Image).toBe('image');
      expect(AttachmentType.Audio).toBe('audio');
    });
  });

  describe('EMBED_NAMING', () => {
    it('should have correct naming patterns', () => {
      expect(EMBED_NAMING.IMAGE_PREFIX).toBe('embed-image-');
      expect(EMBED_NAMING.THUMBNAIL_PREFIX).toBe('embed-thumbnail-');
      expect(EMBED_NAMING.DEFAULT_EXTENSION).toBe('.png');
    });
  });
});
