/**
 * Tests for PersistentVisionCache (L2 PostgreSQL cache)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PersistentVisionCache } from './PersistentVisionCache.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { generateImageDescriptionCacheUuid } from '../utils/deterministicUuid.js';

// Mock logger
vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock structure for imageDescriptionCache operations
interface MockImageDescriptionCache {
  findUnique: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

describe('PersistentVisionCache', () => {
  let mockImageDescriptionCache: MockImageDescriptionCache;
  let cache: PersistentVisionCache;

  beforeEach(() => {
    vi.clearAllMocks();
    mockImageDescriptionCache = {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
    };
    const mockPrisma = {
      imageDescriptionCache: mockImageDescriptionCache,
    } as unknown as PrismaClient;
    cache = new PersistentVisionCache(mockPrisma);
  });

  describe('get', () => {
    it('should return entry when found in cache', async () => {
      const entry = {
        attachmentId: '123456789012345678',
        description: 'A photo of a cat',
        model: 'gpt-4-vision-preview',
      };
      mockImageDescriptionCache.findUnique.mockResolvedValue(entry);

      const result = await cache.get('123456789012345678');

      expect(result).toEqual(entry);
      expect(mockImageDescriptionCache.findUnique).toHaveBeenCalledWith({
        where: { attachmentId: '123456789012345678' },
        select: {
          attachmentId: true,
          description: true,
          model: true,
        },
      });
    });

    it('should return null when not found', async () => {
      mockImageDescriptionCache.findUnique.mockResolvedValue(null);

      const result = await cache.get('nonexistent');

      expect(result).toBeNull();
    });

    it('should propagate database errors', async () => {
      mockImageDescriptionCache.findUnique.mockRejectedValue(new Error('DB error'));

      await expect(cache.get('123')).rejects.toThrow('DB error');
    });
  });

  describe('set', () => {
    it('should upsert entry into cache with deterministic ID', async () => {
      const entry = {
        attachmentId: '123456789012345678',
        description: 'A photo of a dog',
        model: 'claude-3-opus',
      };
      mockImageDescriptionCache.upsert.mockResolvedValue(entry);

      await cache.set(entry);

      expect(mockImageDescriptionCache.upsert).toHaveBeenCalledWith({
        where: { attachmentId: '123456789012345678' },
        create: {
          id: generateImageDescriptionCacheUuid('123456789012345678'),
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

    it('should propagate database errors', async () => {
      mockImageDescriptionCache.upsert.mockRejectedValue(new Error('DB error'));

      await expect(
        cache.set({
          attachmentId: '123',
          description: 'test',
          model: 'test-model',
        })
      ).rejects.toThrow('DB error');
    });
  });

  describe('has', () => {
    it('should return true when entry exists', async () => {
      mockImageDescriptionCache.count.mockResolvedValue(1);

      const result = await cache.has('123456789012345678');

      expect(result).toBe(true);
      expect(mockImageDescriptionCache.count).toHaveBeenCalledWith({
        where: { attachmentId: '123456789012345678' },
      });
    });

    it('should return false when entry does not exist', async () => {
      mockImageDescriptionCache.count.mockResolvedValue(0);

      const result = await cache.has('nonexistent');

      expect(result).toBe(false);
    });

    it('should propagate database errors', async () => {
      mockImageDescriptionCache.count.mockRejectedValue(new Error('DB error'));

      await expect(cache.has('123')).rejects.toThrow('DB error');
    });
  });

  describe('delete', () => {
    it('should delete entry from cache', async () => {
      mockImageDescriptionCache.delete.mockResolvedValue({});

      await cache.delete('123456789012345678');

      expect(mockImageDescriptionCache.delete).toHaveBeenCalledWith({
        where: { attachmentId: '123456789012345678' },
      });
    });

    it('should ignore "not found" errors', async () => {
      mockImageDescriptionCache.delete.mockRejectedValue(
        new Error('Record to delete does not exist')
      );

      // Should not throw
      await expect(cache.delete('nonexistent')).resolves.toBeUndefined();
    });

    it('should propagate other database errors', async () => {
      mockImageDescriptionCache.delete.mockRejectedValue(new Error('Connection error'));

      await expect(cache.delete('123')).rejects.toThrow('Connection error');
    });
  });
});
