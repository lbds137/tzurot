/**
 * Integration Test: RedisService
 *
 * Tests the RedisService that was converted to a service class.
 * Validates webhook message tracking functionality.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RedisService } from './RedisService.js';
import { setupTestEnvironment, type TestEnvironment } from '@tzurot/test-utils';

describe('RedisService Integration', () => {
  let testEnv: TestEnvironment;
  let redisService: RedisService;

  beforeAll(async () => {
    testEnv = await setupTestEnvironment();
    redisService = new RedisService(testEnv.redis);
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  describe('webhook message tracking', () => {
    it('should store and retrieve webhook message mapping', async () => {
      const messageId = '123456789012345678';
      const personalityName = 'Lilith';

      // Store webhook message
      await redisService.storeWebhookMessage(messageId, personalityName);

      // Retrieve personality name
      const retrieved = await redisService.getWebhookPersonality(messageId);

      expect(retrieved).toBe(personalityName);
    });

    it('should return null for non-existent message ID', async () => {
      const nonExistentId = '999999999999999999';

      const result = await redisService.getWebhookPersonality(nonExistentId);

      expect(result).toBeNull();
    });

    it('should handle multiple webhook messages independently', async () => {
      const messageId1 = '111111111111111111';
      const messageId2 = '222222222222222222';
      const personality1 = 'Lilith';
      const personality2 = 'Default';

      // Store both
      await redisService.storeWebhookMessage(messageId1, personality1);
      await redisService.storeWebhookMessage(messageId2, personality2);

      // Retrieve and verify both
      const retrieved1 = await redisService.getWebhookPersonality(messageId1);
      const retrieved2 = await redisService.getWebhookPersonality(messageId2);

      expect(retrieved1).toBe(personality1);
      expect(retrieved2).toBe(personality2);
    });

    it('should overwrite existing message mapping', async () => {
      const messageId = '333333333333333333';
      const personality1 = 'Lilith';
      const personality2 = 'Sarcastic';

      // Store first mapping
      await redisService.storeWebhookMessage(messageId, personality1);

      // Overwrite with second mapping
      await redisService.storeWebhookMessage(messageId, personality2);

      // Should return the updated mapping
      const retrieved = await redisService.getWebhookPersonality(messageId);
      expect(retrieved).toBe(personality2);
    });
  });

  describe('TTL handling', () => {
    it('should respect custom TTL for webhook messages', async () => {
      const messageId = '444444444444444444';
      const personalityName = 'Lilith';
      const ttl = 1; // 1 second

      // Store with short TTL
      await redisService.storeWebhookMessage(messageId, personalityName, ttl);

      // Should be available immediately
      const immediate = await redisService.getWebhookPersonality(messageId);
      expect(immediate).toBe(personalityName);

      // Wait for expiration (1.1 seconds to be safe)
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Should be expired now
      const afterExpiry = await redisService.getWebhookPersonality(messageId);
      expect(afterExpiry).toBeNull();
    });
  });

  describe('health check', () => {
    it('should return true when Redis is healthy', async () => {
      const isHealthy = await redisService.checkHealth();

      expect(isHealthy).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle very long message IDs', async () => {
      const longMessageId = '9'.repeat(100);
      const personalityName = 'Lilith';

      await redisService.storeWebhookMessage(longMessageId, personalityName);

      const retrieved = await redisService.getWebhookPersonality(longMessageId);
      expect(retrieved).toBe(personalityName);
    });

    it('should handle personality names with special characters', async () => {
      const messageId = '555555555555555555';
      const specialName = 'Test-Personality_123 🤖';

      await redisService.storeWebhookMessage(messageId, specialName);

      const retrieved = await redisService.getWebhookPersonality(messageId);
      expect(retrieved).toBe(specialName);
    });

    it('should handle empty personality name', async () => {
      const messageId = '666666666666666666';
      const emptyName = '';

      await redisService.storeWebhookMessage(messageId, emptyName);

      // Empty string might be treated as null by Redis mock
      const retrieved = await redisService.getWebhookPersonality(messageId);
      // Accept either empty string or null (implementation-dependent)
      expect([emptyName, null]).toContain(retrieved);
    });
  });
});
