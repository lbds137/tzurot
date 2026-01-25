import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isValidSlug,
  getSafeAvatarPath,
  deleteAvatarFile,
  extractSlugFromFilename,
  AVATAR_ROOT,
} from './avatarPaths.js';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  unlink: vi.fn(),
}));

import { unlink } from 'fs/promises';
const mockUnlink = vi.mocked(unlink);

describe('avatarPaths', () => {
  describe('AVATAR_ROOT', () => {
    it('should be the expected path', () => {
      expect(AVATAR_ROOT).toBe('/data/avatars');
    });
  });

  describe('isValidSlug', () => {
    it('should accept valid slugs', () => {
      expect(isValidSlug('test-slug')).toBe(true);
      expect(isValidSlug('TestSlug123')).toBe(true);
      expect(isValidSlug('test_slug')).toBe(true);
      expect(isValidSlug('ABC-123_xyz')).toBe(true);
    });

    it('should reject invalid slugs', () => {
      expect(isValidSlug('')).toBe(false);
      expect(isValidSlug('../etc/passwd')).toBe(false);
      expect(isValidSlug('test/slug')).toBe(false);
      expect(isValidSlug('test slug')).toBe(false);
      expect(isValidSlug('test.slug')).toBe(false);
      expect(isValidSlug('test:slug')).toBe(false);
    });
  });

  describe('getSafeAvatarPath', () => {
    it('should return path for valid slug', () => {
      expect(getSafeAvatarPath('test-slug')).toBe('/data/avatars/test-slug.png');
      expect(getSafeAvatarPath('MyAvatar123')).toBe('/data/avatars/MyAvatar123.png');
    });

    it('should return null for invalid slug', () => {
      expect(getSafeAvatarPath('../etc/passwd')).toBeNull();
      expect(getSafeAvatarPath('test/slug')).toBeNull();
      expect(getSafeAvatarPath('')).toBeNull();
    });

    it('should return null for path traversal attempts', () => {
      // Even if somehow the regex was bypassed, the path check would catch it
      expect(getSafeAvatarPath('..%2F..%2Fetc%2Fpasswd')).toBeNull();
    });
  });

  describe('deleteAvatarFile', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should delete file for valid slug', async () => {
      mockUnlink.mockResolvedValue(undefined);

      const result = await deleteAvatarFile('test-slug', 'Test');

      expect(result).toBe(true);
      expect(mockUnlink).toHaveBeenCalledWith('/data/avatars/test-slug.png');
    });

    it('should return false for invalid slug', async () => {
      const result = await deleteAvatarFile('../etc/passwd', 'Test');

      expect(result).toBe(false);
      expect(mockUnlink).not.toHaveBeenCalled();
    });

    it('should return null when file does not exist (ENOENT)', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockUnlink.mockRejectedValue(error);

      const result = await deleteAvatarFile('nonexistent', 'Test');

      expect(result).toBeNull();
    });

    it('should return null when path component is not a directory (ENOTDIR)', async () => {
      const error = new Error('ENOTDIR') as NodeJS.ErrnoException;
      error.code = 'ENOTDIR';
      mockUnlink.mockRejectedValue(error);

      const result = await deleteAvatarFile('test-slug', 'Test');

      expect(result).toBeNull();
    });

    it('should return false on other errors', async () => {
      const error = new Error('Permission denied') as NodeJS.ErrnoException;
      error.code = 'EACCES';
      mockUnlink.mockRejectedValue(error);

      const result = await deleteAvatarFile('test-slug', 'Test');

      expect(result).toBe(false);
    });
  });

  describe('extractSlugFromFilename', () => {
    describe('path-versioned format (with timestamp)', () => {
      it('should extract slug from simple filename with timestamp', () => {
        expect(extractSlugFromFilename('cold-1705827727111.png')).toBe('cold');
      });

      it('should extract slug from hyphenated filename with timestamp', () => {
        expect(extractSlugFromFilename('my-personality-1705827727111.png')).toBe('my-personality');
      });

      it('should extract slug from complex hyphenated filename', () => {
        expect(extractSlugFromFilename('cool-bot-v2-1705827727111.png')).toBe('cool-bot-v2');
      });

      it('should handle underscore slugs with timestamp', () => {
        expect(extractSlugFromFilename('test_slug-1705827727111.png')).toBe('test_slug');
      });

      it('should handle mixed case slugs with timestamp', () => {
        expect(extractSlugFromFilename('TestBot-1705827727111.png')).toBe('TestBot');
      });

      it('should handle 14-digit timestamps (future-proof)', () => {
        // Timestamps will be 14 digits around year 2286
        expect(extractSlugFromFilename('cold-10000000000000.png')).toBe('cold');
      });
    });

    describe('legacy format (without timestamp)', () => {
      it('should extract slug from simple legacy filename', () => {
        expect(extractSlugFromFilename('cold.png')).toBe('cold');
      });

      it('should extract slug from hyphenated legacy filename', () => {
        expect(extractSlugFromFilename('my-personality.png')).toBe('my-personality');
      });

      it('should extract slug from underscore legacy filename', () => {
        expect(extractSlugFromFilename('test_slug.png')).toBe('test_slug');
      });
    });

    describe('invalid filenames', () => {
      it('should return null for filename without .png extension', () => {
        expect(extractSlugFromFilename('cold.jpg')).toBeNull();
        expect(extractSlugFromFilename('cold')).toBeNull();
      });

      it('should return null for empty filename', () => {
        expect(extractSlugFromFilename('')).toBeNull();
      });

      it('should return null for just .png', () => {
        expect(extractSlugFromFilename('.png')).toBeNull();
      });

      it('should handle short number suffixes as part of slug (not timestamp)', () => {
        // Numbers less than 13 digits are part of the slug, not timestamps
        expect(extractSlugFromFilename('bot-v2-123.png')).toBe('bot-v2-123');
        expect(extractSlugFromFilename('test-12345678901.png')).toBe('test-12345678901'); // 11 digits
      });
    });
  });
});
