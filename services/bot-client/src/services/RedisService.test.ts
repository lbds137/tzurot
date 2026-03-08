/**
 * Tests for bot-client RedisService
 *
 * Tests Redis operations for webhook message tracking and TTS audio retrieval.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RedisService } from './RedisService.js';
import type { Redis } from 'ioredis';
import { REDIS_KEY_PREFIXES, INTERVALS } from '@tzurot/common-types';

// Mock dependencies
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

describe('RedisService', () => {
  let mockRedis: {
    setex: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    getBuffer: ReturnType<typeof vi.fn>;
    ping: ReturnType<typeof vi.fn>;
    quit: ReturnType<typeof vi.fn>;
  };

  let redisService: RedisService;

  beforeEach(() => {
    mockRedis = {
      setex: vi.fn(),
      get: vi.fn(),
      getBuffer: vi.fn(),
      ping: vi.fn(),
      quit: vi.fn(),
    };

    redisService = new RedisService(mockRedis as unknown as Redis);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('storeWebhookMessage', () => {
    it('should store message-personality mapping with default TTL', async () => {
      mockRedis.setex.mockResolvedValue('OK');

      await redisService.storeWebhookMessage('msg-123', 'personality-456');

      expect(mockRedis.setex).toHaveBeenCalledWith(
        `${REDIS_KEY_PREFIXES.WEBHOOK_MESSAGE}msg-123`,
        INTERVALS.WEBHOOK_MESSAGE_TTL,
        'personality-456'
      );
    });

    it('should accept custom TTL', async () => {
      mockRedis.setex.mockResolvedValue('OK');

      await redisService.storeWebhookMessage('msg-123', 'personality-456', 3600);

      expect(mockRedis.setex).toHaveBeenCalledWith(expect.any(String), 3600, 'personality-456');
    });

    it('should not throw on Redis error', async () => {
      mockRedis.setex.mockRejectedValue(new Error('Connection lost'));

      await expect(
        redisService.storeWebhookMessage('msg-123', 'personality-456')
      ).resolves.toBeUndefined();
    });
  });

  describe('getWebhookPersonality', () => {
    it('should return personality name when found', async () => {
      mockRedis.get.mockResolvedValue('personality-456');

      const result = await redisService.getWebhookPersonality('msg-123');

      expect(result).toBe('personality-456');
      expect(mockRedis.get).toHaveBeenCalledWith(`${REDIS_KEY_PREFIXES.WEBHOOK_MESSAGE}msg-123`);
    });

    it('should return null when not found', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await redisService.getWebhookPersonality('msg-123');

      expect(result).toBeNull();
    });

    it('should return null on Redis error', async () => {
      mockRedis.get.mockRejectedValue(new Error('Connection lost'));

      const result = await redisService.getWebhookPersonality('msg-123');

      expect(result).toBeNull();
    });
  });

  describe('getTTSAudio', () => {
    it('should return audio buffer when found', async () => {
      const audio = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00]);
      mockRedis.getBuffer.mockResolvedValue(audio);

      const result = await redisService.getTTSAudio('tts-audio:job-123');

      expect(result).toEqual(audio);
      expect(mockRedis.getBuffer).toHaveBeenCalledWith('tts-audio:job-123');
    });

    it('should return null when key not found or expired', async () => {
      mockRedis.getBuffer.mockResolvedValue(null);

      const result = await redisService.getTTSAudio('tts-audio:expired');

      expect(result).toBeNull();
    });

    it('should return null on Redis error', async () => {
      mockRedis.getBuffer.mockRejectedValue(new Error('Connection lost'));

      const result = await redisService.getTTSAudio('tts-audio:job-123');

      expect(result).toBeNull();
    });
  });

  describe('checkHealth', () => {
    it('should return true when Redis responds to ping', async () => {
      mockRedis.ping.mockResolvedValue('PONG');

      const result = await redisService.checkHealth();

      expect(result).toBe(true);
    });

    it('should return false on Redis error', async () => {
      mockRedis.ping.mockRejectedValue(new Error('Connection lost'));

      const result = await redisService.checkHealth();

      expect(result).toBe(false);
    });
  });

  describe('close', () => {
    it('should call redis.quit', async () => {
      mockRedis.quit.mockResolvedValue('OK');

      await redisService.close();

      expect(mockRedis.quit).toHaveBeenCalled();
    });
  });
});
