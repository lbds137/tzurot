import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isValidSlug,
  getSafeAvatarPath,
  deleteAvatarFile,
  extractSlugFromFilename,
  extractTimestampFromFilename,
  cleanupOldAvatarVersions,
  deleteAllAvatarVersions,
  getAvatarSubdir,
  ensureAvatarDir,
  AVATAR_ROOT,
} from './avatarPaths.js';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  unlink: vi.fn(),
  mkdir: vi.fn(),
  glob: vi.fn(),
}));

import { unlink, mkdir, glob } from 'fs/promises';
const mockUnlink = vi.mocked(unlink);
const mockMkdir = vi.mocked(mkdir);
const mockGlob = vi.mocked(glob);

// Helper to create an async generator from an array (simulates glob behavior)
function createAsyncGenerator(items: string[]): AsyncGenerator<string> {
  return (async function* () {
    for (const item of items) {
      yield item;
    }
  })();
}

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

  describe('getAvatarSubdir', () => {
    it('should return first character lowercased', () => {
      expect(getAvatarSubdir('cold')).toBe('c');
      expect(getAvatarSubdir('MyBot')).toBe('m');
      expect(getAvatarSubdir('123bot')).toBe('1');
      expect(getAvatarSubdir('_special')).toBe('_');
      expect(getAvatarSubdir('ABC')).toBe('a');
    });
  });

  describe('getSafeAvatarPath', () => {
    it('should return path with subdirectory for valid slug', () => {
      expect(getSafeAvatarPath('test-slug')).toBe('/data/avatars/t/test-slug.png');
      expect(getSafeAvatarPath('MyAvatar123')).toBe('/data/avatars/m/MyAvatar123.png');
      expect(getSafeAvatarPath('cold')).toBe('/data/avatars/c/cold.png');
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

    it('should return versioned path when timestamp provided', () => {
      expect(getSafeAvatarPath('test-slug', 1705827727111)).toBe(
        '/data/avatars/t/test-slug-1705827727111.png'
      );
      expect(getSafeAvatarPath('cold', 1705827727111)).toBe(
        '/data/avatars/c/cold-1705827727111.png'
      );
    });

    it('should return legacy path when no timestamp provided', () => {
      expect(getSafeAvatarPath('test-slug')).toBe('/data/avatars/t/test-slug.png');
    });

    it('should return null for invalid slug even with timestamp', () => {
      expect(getSafeAvatarPath('../etc/passwd', 1705827727111)).toBeNull();
    });
  });

  describe('ensureAvatarDir', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should create subdirectory and return path for valid slug', async () => {
      mockMkdir.mockResolvedValue(undefined);

      const result = await ensureAvatarDir('cold');

      expect(result).toBe('/data/avatars/c');
      expect(mockMkdir).toHaveBeenCalledWith('/data/avatars/c', { recursive: true });
    });

    it('should return null for invalid slug', async () => {
      const result = await ensureAvatarDir('../etc/passwd');

      expect(result).toBeNull();
      expect(mockMkdir).not.toHaveBeenCalled();
    });

    it('should handle different slug first characters', async () => {
      mockMkdir.mockResolvedValue(undefined);

      const result1 = await ensureAvatarDir('MyBot');
      expect(result1).toBe('/data/avatars/m');
      expect(mockMkdir).toHaveBeenCalledWith('/data/avatars/m', { recursive: true });

      const result2 = await ensureAvatarDir('123bot');
      expect(result2).toBe('/data/avatars/1');
      expect(mockMkdir).toHaveBeenCalledWith('/data/avatars/1', { recursive: true });
    });
  });

  describe('deleteAvatarFile', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should delete file for valid slug with subdirectory path', async () => {
      mockUnlink.mockResolvedValue(undefined);

      const result = await deleteAvatarFile('test-slug', 'Test');

      expect(result).toBe(true);
      expect(mockUnlink).toHaveBeenCalledWith('/data/avatars/t/test-slug.png');
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

    describe('edge cases with numeric slugs', () => {
      it('should handle slugs with version numbers correctly', () => {
        // bot-v2-{timestamp} - v2 is part of slug, timestamp is extracted
        expect(extractSlugFromFilename('bot-v2-1705827727111.png')).toBe('bot-v2');
      });

      it('should treat 13+ digit sequences in slugs as timestamps (greedy match)', () => {
        // When a slug contains 13+ digit numbers, the LAST such sequence is the timestamp
        // This is because the regex is greedy: (.+)-(\d{13,})\.png
        expect(extractSlugFromFilename('test-1234567890123-1705827727111.png')).toBe(
          'test-1234567890123'
        );
      });

      it('should handle purely numeric slugs', () => {
        // A slug that is just numbers with a timestamp
        expect(extractSlugFromFilename('12345-1705827727111.png')).toBe('12345');
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

    it('should extract timestamp from slugs with version numbers', () => {
      // bot-v2-{timestamp} - extracts the actual timestamp
      expect(extractTimestampFromFilename('bot-v2-1705827727111.png')).toBe(1705827727111);
    });

    it('should extract last timestamp when slug contains 13+ digit numbers', () => {
      // The greedy regex matches the LAST 13+ digit sequence as timestamp
      expect(extractTimestampFromFilename('test-1234567890123-1705827727111.png')).toBe(
        1705827727111
      );
    });
  });

  describe('cleanupOldAvatarVersions', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should delete old versions and legacy files, keep current version', async () => {
      mockGlob.mockReturnValue(
        createAsyncGenerator([
          '/data/avatars/c/cold-1705827727111.png', // Old version
          '/data/avatars/c/cold-1705827727222.png', // Current version (should keep)
          '/data/avatars/c/cold.png', // Legacy file (should delete)
        ])
      );
      mockUnlink.mockResolvedValue(undefined);

      const result = await cleanupOldAvatarVersions('cold', 1705827727222);

      expect(result).toBe(2); // Deleted old version + legacy
      expect(mockUnlink).toHaveBeenCalledTimes(2);
      expect(mockUnlink).toHaveBeenCalledWith('/data/avatars/c/cold-1705827727111.png');
      expect(mockUnlink).toHaveBeenCalledWith('/data/avatars/c/cold.png');
    });

    it('should not delete files with prefix match but different slug', async () => {
      mockGlob.mockReturnValue(
        createAsyncGenerator([
          '/data/avatars/c/cold-1705827727222.png', // Current version
          '/data/avatars/c/cold-bot-1705827727111.png', // Different slug (cold-bot)
        ])
      );

      const result = await cleanupOldAvatarVersions('cold', 1705827727222);

      expect(result).toBe(0);
      expect(mockUnlink).not.toHaveBeenCalled();
    });

    it('should return 0 when no old versions exist', async () => {
      mockGlob.mockReturnValue(
        createAsyncGenerator([
          '/data/avatars/c/cold-1705827727222.png', // Current version only
        ])
      );

      const result = await cleanupOldAvatarVersions('cold', 1705827727222);

      expect(result).toBe(0);
      expect(mockUnlink).not.toHaveBeenCalled();
    });

    it('should return 0 when avatar directory does not exist', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockGlob.mockImplementation(() => {
        throw error;
      });

      const result = await cleanupOldAvatarVersions('cold', 1705827727222);

      expect(result).toBe(0);
    });

    it('should return null for invalid slug', async () => {
      const result = await cleanupOldAvatarVersions('../etc/passwd', 1705827727222);

      expect(result).toBeNull();
      expect(mockGlob).not.toHaveBeenCalled();
    });

    it('should continue cleanup even if some files fail to delete', async () => {
      mockGlob.mockReturnValue(
        createAsyncGenerator([
          '/data/avatars/c/cold-1111111111111.png',
          '/data/avatars/c/cold-2222222222222.png',
        ])
      );

      const error = new Error('EACCES') as NodeJS.ErrnoException;
      error.code = 'EACCES';
      mockUnlink.mockRejectedValueOnce(error).mockResolvedValueOnce(undefined);

      const result = await cleanupOldAvatarVersions('cold', 3333333333333);

      // Should still count the successful deletion
      expect(result).toBe(1);
    });

    it('should use correct glob pattern with subdirectory', async () => {
      mockGlob.mockReturnValue(createAsyncGenerator([]));

      await cleanupOldAvatarVersions('cold', 1705827727222);

      expect(mockGlob).toHaveBeenCalledWith('/data/avatars/c/cold*.png');
    });

    it('should use correct subdirectory for different slugs', async () => {
      mockGlob.mockReturnValue(createAsyncGenerator([]));

      await cleanupOldAvatarVersions('MyBot', 1705827727222);
      expect(mockGlob).toHaveBeenCalledWith('/data/avatars/m/MyBot*.png');

      await cleanupOldAvatarVersions('123test', 1705827727222);
      expect(mockGlob).toHaveBeenCalledWith('/data/avatars/1/123test*.png');
    });

    it('should limit glob results to prevent memory issues', async () => {
      // Create more files than the limit (GLOB_RESULT_LIMIT = 1000)
      const manyFiles = Array.from(
        { length: 1100 },
        (_, i) => `/data/avatars/c/cold-${1705827727111 + i}.png`
      );
      mockGlob.mockReturnValue(createAsyncGenerator(manyFiles));
      mockUnlink.mockResolvedValue(undefined);

      const result = await cleanupOldAvatarVersions('cold', 9999999999999);

      // Should only process up to limit (1000), skipping current timestamp
      // All 1000 files have different timestamps, so all should be deleted
      expect(result).toBe(1000);
      expect(mockUnlink).toHaveBeenCalledTimes(1000);
    });
  });

  describe('deleteAllAvatarVersions', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should delete all versions for a slug', async () => {
      mockGlob.mockReturnValue(
        createAsyncGenerator([
          '/data/avatars/c/cold-1705827727111.png',
          '/data/avatars/c/cold-1705827727222.png',
          '/data/avatars/c/cold.png',
        ])
      );
      mockUnlink.mockResolvedValue(undefined);

      const result = await deleteAllAvatarVersions('cold', 'Test delete');

      expect(result).toBe(3); // All three cold files
      expect(mockUnlink).toHaveBeenCalledTimes(3);
      expect(mockUnlink).toHaveBeenCalledWith('/data/avatars/c/cold-1705827727111.png');
      expect(mockUnlink).toHaveBeenCalledWith('/data/avatars/c/cold-1705827727222.png');
      expect(mockUnlink).toHaveBeenCalledWith('/data/avatars/c/cold.png');
    });

    it('should not delete files with prefix match but different slug', async () => {
      mockGlob.mockReturnValue(
        createAsyncGenerator([
          '/data/avatars/c/cold-1705827727111.png',
          '/data/avatars/c/cold-bot-1705827727222.png', // Different slug
        ])
      );
      mockUnlink.mockResolvedValue(undefined);

      const result = await deleteAllAvatarVersions('cold', 'Test delete');

      expect(result).toBe(1); // Only cold file, not cold-bot
      expect(mockUnlink).toHaveBeenCalledTimes(1);
      expect(mockUnlink).toHaveBeenCalledWith('/data/avatars/c/cold-1705827727111.png');
    });

    it('should return 0 when no files for slug exist', async () => {
      mockGlob.mockReturnValue(createAsyncGenerator([]));

      const result = await deleteAllAvatarVersions('cold', 'Test delete');

      expect(result).toBe(0);
      expect(mockUnlink).not.toHaveBeenCalled();
    });

    it('should return 0 when avatar directory does not exist', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockGlob.mockImplementation(() => {
        throw error;
      });

      const result = await deleteAllAvatarVersions('cold', 'Test delete');

      expect(result).toBe(0);
    });

    it('should return null for invalid slug', async () => {
      const result = await deleteAllAvatarVersions('../etc/passwd', 'Test delete');

      expect(result).toBeNull();
      expect(mockGlob).not.toHaveBeenCalled();
    });

    it('should ignore ENOENT errors during file deletion', async () => {
      mockGlob.mockReturnValue(
        createAsyncGenerator([
          '/data/avatars/c/cold-1111111111111.png',
          '/data/avatars/c/cold-2222222222222.png',
        ])
      );

      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      // First file was already deleted, second succeeds
      mockUnlink.mockRejectedValueOnce(error).mockResolvedValueOnce(undefined);

      const result = await deleteAllAvatarVersions('cold', 'Test delete');

      // Only counts successful deletion
      expect(result).toBe(1);
    });

    it('should use correct glob pattern with subdirectory', async () => {
      mockGlob.mockReturnValue(createAsyncGenerator([]));

      await deleteAllAvatarVersions('cold', 'Test');

      expect(mockGlob).toHaveBeenCalledWith('/data/avatars/c/cold*.png');
    });
  });
});
