/**
 * Integration Test: VoiceTranscriptCache
 *
 * Tests the VoiceTranscriptCache service that was extracted to common-types.
 * Validates that it correctly stores and retrieves voice transcripts from Redis.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VoiceTranscriptCache } from './VoiceTranscriptCache.js';
import { setupTestEnvironment, type TestEnvironment } from '@tzurot/test-utils';

describe('VoiceTranscriptCache Integration', () => {
  let testEnv: TestEnvironment;
  let cache: VoiceTranscriptCache;

  beforeAll(async () => {
    testEnv = await setupTestEnvironment();
    cache = new VoiceTranscriptCache(testEnv.redis);
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  describe('store and get', () => {
    it('should store and retrieve a voice transcript', async () => {
      const attachmentUrl = 'https://cdn.discordapp.com/attachments/123/456/audio.ogg';
      const transcript = 'Hello, this is a test transcript';

      // Store transcript
      await cache.store(attachmentUrl, transcript);

      // Retrieve transcript
      const retrieved = await cache.get(attachmentUrl);

      expect(retrieved).toBe(transcript);
    });

    it('should return null for non-existent transcript', async () => {
      const nonExistentUrl = 'https://cdn.discordapp.com/attachments/999/999/nonexistent.ogg';

      const result = await cache.get(nonExistentUrl);

      expect(result).toBeNull();
    });

    it('should handle multiple transcripts independently', async () => {
      const url1 = 'https://cdn.discordapp.com/attachments/111/222/audio1.ogg';
      const url2 = 'https://cdn.discordapp.com/attachments/333/444/audio2.ogg';
      const transcript1 = 'First transcript';
      const transcript2 = 'Second transcript';

      // Store both
      await cache.store(url1, transcript1);
      await cache.store(url2, transcript2);

      // Retrieve and verify both
      const retrieved1 = await cache.get(url1);
      const retrieved2 = await cache.get(url2);

      expect(retrieved1).toBe(transcript1);
      expect(retrieved2).toBe(transcript2);
    });

    it('should overwrite existing transcript with same URL', async () => {
      const url = 'https://cdn.discordapp.com/attachments/555/666/audio.ogg';
      const transcript1 = 'First version';
      const transcript2 = 'Updated version';

      // Store first version
      await cache.store(url, transcript1);

      // Overwrite with second version
      await cache.store(url, transcript2);

      // Should return the updated version
      const retrieved = await cache.get(url);
      expect(retrieved).toBe(transcript2);
    });
  });

  describe('TTL handling', () => {
    it('should respect custom TTL', async () => {
      const url = 'https://cdn.discordapp.com/attachments/777/888/audio.ogg';
      const transcript = 'Short-lived transcript';
      const ttl = 1; // 1 second

      // Store with short TTL
      await cache.store(url, transcript, ttl);

      // Should be available immediately
      const immediate = await cache.get(url);
      expect(immediate).toBe(transcript);

      // Wait for expiration (1.1 seconds to be safe)
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Should be expired now
      const afterExpiry = await cache.get(url);
      expect(afterExpiry).toBeNull();
    });
  });

  describe('Edge cases', () => {
    it('should handle empty transcript', async () => {
      const url = 'https://cdn.discordapp.com/attachments/999/111/empty.ogg';
      const emptyTranscript = '';

      await cache.store(url, emptyTranscript);

      // Empty string is treated as null by VoiceTranscriptCache (intentional behavior)
      // The cache checks `transcript.length > 0` before returning
      const retrieved = await cache.get(url);
      expect(retrieved).toBeNull();
    });

    it('should handle very long transcripts', async () => {
      const url = 'https://cdn.discordapp.com/attachments/222/333/long.ogg';
      const longTranscript = 'a'.repeat(10000); // 10KB of 'a's

      await cache.store(url, longTranscript);

      const retrieved = await cache.get(url);
      expect(retrieved).toBe(longTranscript);
      expect(retrieved?.length).toBe(10000);
    });

    it('should handle special characters in transcript', async () => {
      const url = 'https://cdn.discordapp.com/attachments/444/555/special.ogg';
      const specialTranscript = 'Hello 👋 World! \n\t Special: "quotes" & <tags>';

      await cache.store(url, specialTranscript);

      const retrieved = await cache.get(url);
      expect(retrieved).toBe(specialTranscript);
    });
  });
});
