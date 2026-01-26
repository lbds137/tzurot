import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isValidSlug,
  getSafeAvatarPath,
  deleteAvatarFile,
  extractSlugFromFilename,
  extractTimestampFromFilename,
  cleanupOldAvatarVersions,
  deleteAllAvatarVersions,
  AVATAR_ROOT,
} from './avatarPaths.js';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  unlink: vi.fn(),
  readdir: vi.fn(),
}));

import { unlink, readdir } from 'fs/promises';
const mockUnlink = vi.mocked(unlink);
const mockReaddir = vi.mocked(readdir);

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

  describe('extractTimestampFromFilename', () => {
    it('should extract timestamp from versioned filename', () => {
      expect(extractTimestampFromFilename('cold-1705827727111.png')).toBe(1705827727111);
    });

    it('should extract timestamp from hyphenated slug with timestamp', () => {
      expect(extractTimestampFromFilename('my-personality-1705827727111.png')).toBe(1705827727111);
    });

    it('should return null for legacy filename (no timestamp)', () => {
      expect(extractTimestampFromFilename('cold.png')).toBeNull();
      expect(extractTimestampFromFilename('my-personality.png')).toBeNull();
    });

    it('should return null for invalid filename', () => {
      expect(extractTimestampFromFilename('cold.jpg')).toBeNull();
      expect(extractTimestampFromFilename('')).toBeNull();
    });

    it('should return null for short number suffixes (not timestamps)', () => {
      // Numbers less than 13 digits are not timestamps
      expect(extractTimestampFromFilename('bot-v2-123.png')).toBeNull();
      expect(extractTimestampFromFilename('test-12345678901.png')).toBeNull(); // 11 digits
    });
  });

  describe('getSafeAvatarPath with timestamp', () => {
    it('should return versioned path when timestamp provided', () => {
      expect(getSafeAvatarPath('test-slug', 1705827727111)).toBe(
        '/data/avatars/test-slug-1705827727111.png'
      );
    });

    it('should return legacy path when no timestamp provided', () => {
      expect(getSafeAvatarPath('test-slug')).toBe('/data/avatars/test-slug.png');
    });

    it('should return null for invalid slug even with timestamp', () => {
      expect(getSafeAvatarPath('../etc/passwd', 1705827727111)).toBeNull();
    });
  });

  describe('cleanupOldAvatarVersions', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should delete old versions and legacy files, keep current version', async () => {
      mockReaddir.mockResolvedValue([
        'cold-1705827727111.png', // Old version
        'cold-1705827727222.png', // Current version (should keep)
        'cold.png', // Legacy file (should delete)
        'other-personality.png', // Different slug (should keep)
      ] as unknown as Awaited<ReturnType<typeof readdir>>);
      mockUnlink.mockResolvedValue(undefined);

      const result = await cleanupOldAvatarVersions('cold', 1705827727222);

      expect(result).toBe(2); // Deleted old version + legacy
      expect(mockUnlink).toHaveBeenCalledTimes(2);
      expect(mockUnlink).toHaveBeenCalledWith('/data/avatars/cold-1705827727111.png');
      expect(mockUnlink).toHaveBeenCalledWith('/data/avatars/cold.png');
    });

    it('should return 0 when no old versions exist', async () => {
      mockReaddir.mockResolvedValue([
        'cold-1705827727222.png', // Current version only
        'other.png',
      ] as unknown as Awaited<ReturnType<typeof readdir>>);

      const result = await cleanupOldAvatarVersions('cold', 1705827727222);

      expect(result).toBe(0);
      expect(mockUnlink).not.toHaveBeenCalled();
    });

    it('should return 0 when avatar directory does not exist', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockReaddir.mockRejectedValue(error);

      const result = await cleanupOldAvatarVersions('cold', 1705827727222);

      expect(result).toBe(0);
    });

    it('should return null for invalid slug', async () => {
      const result = await cleanupOldAvatarVersions('../etc/passwd', 1705827727222);

      expect(result).toBeNull();
      expect(mockReaddir).not.toHaveBeenCalled();
    });

    it('should continue cleanup even if some files fail to delete', async () => {
      mockReaddir.mockResolvedValue([
        'cold-1111111111111.png',
        'cold-2222222222222.png',
      ] as unknown as Awaited<ReturnType<typeof readdir>>);

      const error = new Error('EACCES') as NodeJS.ErrnoException;
      error.code = 'EACCES';
      mockUnlink.mockRejectedValueOnce(error).mockResolvedValueOnce(undefined);

      const result = await cleanupOldAvatarVersions('cold', 3333333333333);

      // Should still count the successful deletion
      expect(result).toBe(1);
    });
  });

  describe('deleteAllAvatarVersions', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should delete all versions for a slug', async () => {
      mockReaddir.mockResolvedValue([
        'cold-1705827727111.png',
        'cold-1705827727222.png',
        'cold.png',
        'other-personality.png', // Different slug
      ] as unknown as Awaited<ReturnType<typeof readdir>>);
      mockUnlink.mockResolvedValue(undefined);

      const result = await deleteAllAvatarVersions('cold', 'Test delete');

      expect(result).toBe(3); // All three cold files
      expect(mockUnlink).toHaveBeenCalledTimes(3);
      expect(mockUnlink).toHaveBeenCalledWith('/data/avatars/cold-1705827727111.png');
      expect(mockUnlink).toHaveBeenCalledWith('/data/avatars/cold-1705827727222.png');
      expect(mockUnlink).toHaveBeenCalledWith('/data/avatars/cold.png');
    });

    it('should return 0 when no files for slug exist', async () => {
      mockReaddir.mockResolvedValue(['other.png', 'another-personality.png'] as unknown as Awaited<
        ReturnType<typeof readdir>
      >);

      const result = await deleteAllAvatarVersions('cold', 'Test delete');

      expect(result).toBe(0);
      expect(mockUnlink).not.toHaveBeenCalled();
    });

    it('should return 0 when avatar directory does not exist', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockReaddir.mockRejectedValue(error);

      const result = await deleteAllAvatarVersions('cold', 'Test delete');

      expect(result).toBe(0);
    });

    it('should return null for invalid slug', async () => {
      const result = await deleteAllAvatarVersions('../etc/passwd', 'Test delete');

      expect(result).toBeNull();
      expect(mockReaddir).not.toHaveBeenCalled();
    });

    it('should ignore ENOENT errors during file deletion', async () => {
      mockReaddir.mockResolvedValue([
        'cold-1111111111111.png',
        'cold-2222222222222.png',
      ] as unknown as Awaited<ReturnType<typeof readdir>>);

      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      // First file was already deleted, second succeeds
      mockUnlink.mockRejectedValueOnce(error).mockResolvedValueOnce(undefined);

      const result = await deleteAllAvatarVersions('cold', 'Test delete');

      // Only counts successful deletion
      expect(result).toBe(1);
    });
  });
});
