/**
 * Tests for PersistentVisionCache (L2 PostgreSQL cache)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PersistentVisionCache } from './PersistentVisionCache.js';

// Mock logger
vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('PersistentVisionCache', () => {
  const mockPrisma = {
    imageDescriptionCache: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
    },
  };

  let cache: PersistentVisionCache;

  beforeEach(() => {
    vi.clearAllMocks();
    cache = new PersistentVisionCache(mockPrisma as never);
  });

  describe('get', () => {
    it('should return entry when found in cache', async () => {
      const entry = {
        attachmentId: '123456789012345678',
        description: 'A photo of a cat',
        model: 'gpt-4-vision-preview',
      };
      mockPrisma.imageDescriptionCache.findUnique.mockResolvedValue(entry);

      const result = await cache.get('123456789012345678');

      expect(result).toEqual(entry);
      expect(mockPrisma.imageDescriptionCache.findUnique).toHaveBeenCalledWith({
        where: { attachmentId: '123456789012345678' },
        select: {
          attachmentId: true,
          description: true,
          model: true,
        },
      });
    });

    it('should return null when not found', async () => {
      mockPrisma.imageDescriptionCache.findUnique.mockResolvedValue(null);

      const result = await cache.get('nonexistent');

      expect(result).toBeNull();
    });

    it('should return null and log error on database failure', async () => {
      mockPrisma.imageDescriptionCache.findUnique.mockRejectedValue(new Error('DB error'));

      const result = await cache.get('123');

      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('should upsert entry into cache', async () => {
      const entry = {
        attachmentId: '123456789012345678',
        description: 'A photo of a dog',
        model: 'claude-3-opus',
      };
      mockPrisma.imageDescriptionCache.upsert.mockResolvedValue(entry);

      await cache.set(entry);

      expect(mockPrisma.imageDescriptionCache.upsert).toHaveBeenCalledWith({
        where: { attachmentId: '123456789012345678' },
        create: {
          attachmentId: '123456789012345678',
          description: 'A photo of a dog',
          model: 'claude-3-opus',
        },
        update: {
          description: 'A photo of a dog',
          model: 'claude-3-opus',
        },
      });
    });

    it('should handle database errors gracefully', async () => {
      mockPrisma.imageDescriptionCache.upsert.mockRejectedValue(new Error('DB error'));

      // Should not throw
      await expect(
        cache.set({
          attachmentId: '123',
          description: 'test',
          model: 'test-model',
        })
      ).resolves.toBeUndefined();
    });
  });

  describe('has', () => {
    it('should return true when entry exists', async () => {
      mockPrisma.imageDescriptionCache.count.mockResolvedValue(1);

      const result = await cache.has('123456789012345678');

      expect(result).toBe(true);
      expect(mockPrisma.imageDescriptionCache.count).toHaveBeenCalledWith({
        where: { attachmentId: '123456789012345678' },
      });
    });

    it('should return false when entry does not exist', async () => {
      mockPrisma.imageDescriptionCache.count.mockResolvedValue(0);

      const result = await cache.has('nonexistent');

      expect(result).toBe(false);
    });

    it('should return false on database error', async () => {
      mockPrisma.imageDescriptionCache.count.mockRejectedValue(new Error('DB error'));

      const result = await cache.has('123');

      expect(result).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete entry from cache', async () => {
      mockPrisma.imageDescriptionCache.delete.mockResolvedValue({});

      await cache.delete('123456789012345678');

      expect(mockPrisma.imageDescriptionCache.delete).toHaveBeenCalledWith({
        where: { attachmentId: '123456789012345678' },
      });
    });

    it('should ignore "not found" errors', async () => {
      mockPrisma.imageDescriptionCache.delete.mockRejectedValue(
        new Error('Record to delete does not exist')
      );

      // Should not throw
      await expect(cache.delete('nonexistent')).resolves.toBeUndefined();
    });

    it('should handle other database errors gracefully', async () => {
      mockPrisma.imageDescriptionCache.delete.mockRejectedValue(new Error('Connection error'));

      // Should not throw
      await expect(cache.delete('123')).resolves.toBeUndefined();
    });
  });
});
