import { describe, it, expect } from 'vitest';
import { validateImageAttachment, validateAudioAttachment } from './mediaValidation.js';
import { MAX_INPUT_SIZE_BYTES } from './avatarUtils.js';

describe('mediaValidation', () => {
  describe('validateImageAttachment', () => {
    it('accepts a valid image', () => {
      expect(validateImageAttachment({ contentType: 'image/png', size: 1024 })).toBeNull();
    });

    it('rejects a non-image content type with the unified message', () => {
      expect(validateImageAttachment({ contentType: 'application/pdf', size: 1024 })).toContain(
        'Invalid image format'
      );
    });

    it('rejects a null content type', () => {
      expect(validateImageAttachment({ contentType: null, size: 1024 })).toContain(
        'Invalid image format'
      );
    });

    it('rejects an oversize image with the unified "too large" message', () => {
      const err = validateImageAttachment({
        contentType: 'image/png',
        size: MAX_INPUT_SIZE_BYTES + 1,
      });
      expect(err).toContain('Image too large');
      expect(err).toContain('under');
    });
  });

  describe('validateAudioAttachment', () => {
    it('accepts any audio/* content type (broader than server ALLOWED_TYPES)', () => {
      expect(validateAudioAttachment({ contentType: 'audio/wav', size: 1024 })).toBeNull();
      expect(validateAudioAttachment({ contentType: 'audio/mpeg', size: 1024 })).toBeNull();
    });

    it('rejects a non-audio content type with the unified message', () => {
      expect(validateAudioAttachment({ contentType: 'video/mp4', size: 1024 })).toContain(
        'Invalid audio format'
      );
    });

    it('rejects a null content type', () => {
      expect(validateAudioAttachment({ contentType: null, size: 1024 })).toContain(
        'Invalid audio format'
      );
    });

    it('rejects an oversize audio file', () => {
      const err = validateAudioAttachment({ contentType: 'audio/wav', size: 500 * 1024 * 1024 });
      expect(err).toContain('Audio too large');
    });
  });
});
