/**
 * Integration Test: VisionDescriptionCache
 *
 * Tests the VisionDescriptionCache service that caches image descriptions
 * to avoid duplicate vision API calls across different code paths.
 *
 * The cache uses a two-tier lookup strategy:
 * - Primary: attachmentId (Discord snowflake) - stable, preferred
 * - Fallback: URL hash - for backwards compatibility
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VisionDescriptionCache } from './VisionDescriptionCache.js';
import { setupTestEnvironment, type TestEnvironment } from '@tzurot/test-utils';

describe('VisionDescriptionCache Integration', () => {
  let testEnv: TestEnvironment;
  let cache: VisionDescriptionCache;

  beforeAll(async () => {
    testEnv = await setupTestEnvironment();
    cache = new VisionDescriptionCache(testEnv.redis);
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  describe('store and get', () => {
    it('should store and retrieve an image description', async () => {
      const attachmentId = '123456789012345678';
      const imageUrl = 'https://cdn.discordapp.com/attachments/123/456/image.png';
      const description = 'A colorful sunset over the ocean with clouds';

      // Store description with attachmentId and url
      await cache.store({ attachmentId, url: imageUrl, model: 'gpt-4-vision' }, description);

      // Retrieve description using attachmentId
      const retrieved = await cache.get({ attachmentId, url: imageUrl });

      expect(retrieved).toBe(description);
    });

    it('should return null for non-existent image description', async () => {
      const nonExistentId = '999999999999999999';
      const nonExistentUrl = 'https://cdn.discordapp.com/attachments/999/999/nonexistent.png';

      const result = await cache.get({ attachmentId: nonExistentId, url: nonExistentUrl });

      expect(result).toBeNull();
    });

    it('should handle multiple image descriptions independently', async () => {
      const id1 = '111222333444555666';
      const id2 = '777888999000111222';
      const url1 = 'https://cdn.discordapp.com/attachments/111/222/image1.png';
      const url2 = 'https://cdn.discordapp.com/attachments/333/444/image2.jpg';
      const description1 = 'A mountain landscape with snow peaks';
      const description2 = 'A group of people at a party';

      // Store both
      await cache.store({ attachmentId: id1, url: url1, model: 'gpt-4-vision' }, description1);
      await cache.store({ attachmentId: id2, url: url2, model: 'gpt-4-vision' }, description2);

      // Retrieve and verify both
      const retrieved1 = await cache.get({ attachmentId: id1, url: url1 });
      const retrieved2 = await cache.get({ attachmentId: id2, url: url2 });

      expect(retrieved1).toBe(description1);
      expect(retrieved2).toBe(description2);
    });

    it('should overwrite existing description with same attachmentId', async () => {
      const attachmentId = '555666777888999000';
      const url = 'https://cdn.discordapp.com/attachments/555/666/image.png';
      const description1 = 'First description';
      const description2 = 'Updated description with more detail';

      // Store first version
      await cache.store({ attachmentId, url, model: 'gpt-4-vision' }, description1);

      // Overwrite with second version
      await cache.store({ attachmentId, url, model: 'gpt-4-vision' }, description2);

      // Should return the updated version
      const retrieved = await cache.get({ attachmentId, url });
      expect(retrieved).toBe(description2);
    });
  });

  describe('TTL handling', () => {
    it('should respect custom TTL', async () => {
      const attachmentId = '777888999111222333';
      const url = 'https://cdn.discordapp.com/attachments/777/888/image.png';
      const description = 'Short-lived image description';
      const ttl = 1; // 1 second

      // Store with short TTL
      await cache.store({ attachmentId, url, model: 'gpt-4-vision' }, description, ttl);

      // Should be available immediately
      const immediate = await cache.get({ attachmentId, url });
      expect(immediate).toBe(description);

      // Wait for expiration (1.1 seconds to be safe)
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Should be expired now
      const afterExpiry = await cache.get({ attachmentId, url });
      expect(afterExpiry).toBeNull();
    });
  });

  describe('Edge cases', () => {
    it('should handle empty description', async () => {
      const attachmentId = '999111222333444555';
      const url = 'https://cdn.discordapp.com/attachments/999/111/empty.png';
      const emptyDescription = '';

      await cache.store({ attachmentId, url, model: 'gpt-4-vision' }, emptyDescription);

      // Empty string is treated as null (intentional behavior)
      // The cache checks `description.length > 0` before returning
      const retrieved = await cache.get({ attachmentId, url });
      expect(retrieved).toBeNull();
    });

    it('should handle very long descriptions', async () => {
      const attachmentId = '222333444555666777';
      const url = 'https://cdn.discordapp.com/attachments/222/333/detailed.png';
      const longDescription = 'This is a very detailed image showing '.repeat(100);

      await cache.store({ attachmentId, url, model: 'gpt-4-vision' }, longDescription);

      const retrieved = await cache.get({ attachmentId, url });
      expect(retrieved).toBe(longDescription);
    });

    it('should handle special characters in description', async () => {
      const attachmentId = '444555666777888999';
      const url = 'https://cdn.discordapp.com/attachments/444/555/special.png';
      const specialDescription =
        'Image shows: "quoted text", <html tags>, 日本語, 🎨 emojis, \n newlines';

      await cache.store({ attachmentId, url, model: 'gpt-4-vision' }, specialDescription);

      const retrieved = await cache.get({ attachmentId, url });
      expect(retrieved).toBe(specialDescription);
    });

    it('should handle URLs with special characters', async () => {
      const attachmentId = '666777888999000111';
      const url =
        'https://cdn.discordapp.com/attachments/123/456/image%20with%20spaces.png?ex=abc&is=def';
      const description = 'A normal image description';

      await cache.store({ attachmentId, url, model: 'gpt-4-vision' }, description);

      const retrieved = await cache.get({ attachmentId, url });
      expect(retrieved).toBe(description);
    });
  });

  describe('Cache key isolation', () => {
    it('should treat different attachmentIds as different cache keys', async () => {
      const baseId = '888999000111222333';
      const otherId = '999000111222333444';
      const url = 'https://cdn.discordapp.com/attachments/123/456/image.png';

      await cache.store(
        { attachmentId: baseId, url, model: 'gpt-4-vision' },
        'Base ID description'
      );
      await cache.store(
        { attachmentId: otherId, url, model: 'gpt-4-vision' },
        'Other ID description'
      );

      // Should be different cache entries based on attachmentId
      const baseResult = await cache.get({ attachmentId: baseId, url });
      const otherResult = await cache.get({ attachmentId: otherId, url });

      expect(baseResult).toBe('Base ID description');
      expect(otherResult).toBe('Other ID description');
    });
  });
});
