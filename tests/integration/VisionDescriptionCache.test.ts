/**
 * Integration Test: VisionDescriptionCache
 *
 * Tests the VisionDescriptionCache service that caches image descriptions
 * to avoid duplicate vision API calls across different code paths.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VisionDescriptionCache } from '@tzurot/common-types';
import { setupTestEnvironment, type TestEnvironment } from './setup';

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
      const imageUrl = 'https://cdn.discordapp.com/attachments/123/456/image.png';
      const description = 'A colorful sunset over the ocean with clouds';

      // Store description
      await cache.store(imageUrl, description);

      // Retrieve description
      const retrieved = await cache.get(imageUrl);

      expect(retrieved).toBe(description);
    });

    it('should return null for non-existent image description', async () => {
      const nonExistentUrl = 'https://cdn.discordapp.com/attachments/999/999/nonexistent.png';

      const result = await cache.get(nonExistentUrl);

      expect(result).toBeNull();
    });

    it('should handle multiple image descriptions independently', async () => {
      const url1 = 'https://cdn.discordapp.com/attachments/111/222/image1.png';
      const url2 = 'https://cdn.discordapp.com/attachments/333/444/image2.jpg';
      const description1 = 'A mountain landscape with snow peaks';
      const description2 = 'A group of people at a party';

      // Store both
      await cache.store(url1, description1);
      await cache.store(url2, description2);

      // Retrieve and verify both
      const retrieved1 = await cache.get(url1);
      const retrieved2 = await cache.get(url2);

      expect(retrieved1).toBe(description1);
      expect(retrieved2).toBe(description2);
    });

    it('should overwrite existing description with same URL', async () => {
      const url = 'https://cdn.discordapp.com/attachments/555/666/image.png';
      const description1 = 'First description';
      const description2 = 'Updated description with more detail';

      // Store first version
      await cache.store(url, description1);

      // Overwrite with second version
      await cache.store(url, description2);

      // Should return the updated version
      const retrieved = await cache.get(url);
      expect(retrieved).toBe(description2);
    });
  });

  describe('TTL handling', () => {
    it('should respect custom TTL', async () => {
      const url = 'https://cdn.discordapp.com/attachments/777/888/image.png';
      const description = 'Short-lived image description';
      const ttl = 1; // 1 second

      // Store with short TTL
      await cache.store(url, description, ttl);

      // Should be available immediately
      const immediate = await cache.get(url);
      expect(immediate).toBe(description);

      // Wait for expiration (1.1 seconds to be safe)
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Should be expired now
      const afterExpiry = await cache.get(url);
      expect(afterExpiry).toBeNull();
    });
  });

  describe('Edge cases', () => {
    it('should handle empty description', async () => {
      const url = 'https://cdn.discordapp.com/attachments/999/111/empty.png';
      const emptyDescription = '';

      await cache.store(url, emptyDescription);

      // Empty string is treated as null (intentional behavior)
      // The cache checks `description.length > 0` before returning
      const retrieved = await cache.get(url);
      expect(retrieved).toBeNull();
    });

    it('should handle very long descriptions', async () => {
      const url = 'https://cdn.discordapp.com/attachments/222/333/detailed.png';
      const longDescription = 'This is a very detailed image showing '.repeat(100);

      await cache.store(url, longDescription);

      const retrieved = await cache.get(url);
      expect(retrieved).toBe(longDescription);
    });

    it('should handle special characters in description', async () => {
      const url = 'https://cdn.discordapp.com/attachments/444/555/special.png';
      const specialDescription =
        'Image shows: "quoted text", <html tags>, 日本語, 🎨 emojis, \n newlines';

      await cache.store(url, specialDescription);

      const retrieved = await cache.get(url);
      expect(retrieved).toBe(specialDescription);
    });

    it('should handle URLs with special characters', async () => {
      const url =
        'https://cdn.discordapp.com/attachments/123/456/image%20with%20spaces.png?ex=abc&is=def';
      const description = 'A normal image description';

      await cache.store(url, description);

      const retrieved = await cache.get(url);
      expect(retrieved).toBe(description);
    });
  });

  describe('Cache key isolation', () => {
    it('should treat different URLs as different cache keys', async () => {
      const baseUrl = 'https://cdn.discordapp.com/attachments/123/456/image.png';
      const urlWithParams = `${baseUrl}?width=100`;

      await cache.store(baseUrl, 'Base URL description');
      await cache.store(urlWithParams, 'URL with params description');

      // Should be different cache entries
      const baseResult = await cache.get(baseUrl);
      const paramsResult = await cache.get(urlWithParams);

      expect(baseResult).toBe('Base URL description');
      expect(paramsResult).toBe('URL with params description');
    });
  });
});
