import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isValidSlug, getSafeAvatarPath, deleteAvatarFile, AVATAR_ROOT } from './avatarPaths.js';

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
});
