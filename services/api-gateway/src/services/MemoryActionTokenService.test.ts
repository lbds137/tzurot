/**
 * Tests for MemoryActionTokenService
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import { MemoryActionTokenService } from './MemoryActionTokenService.js';
import { REDIS_KEY_PREFIXES, type BatchDeletePreviewInput } from '@tzurot/common-types';

function createMockRedis(): Redis {
  return {
    setex: vi.fn().mockResolvedValue('OK'),
    getdel: vi.fn().mockResolvedValue(null),
  } as unknown as Redis;
}

describe('MemoryActionTokenService', () => {
  let redis: Redis;
  let service: MemoryActionTokenService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-26T12:00:00.000Z'));
    redis = createMockRedis();
    service = new MemoryActionTokenService(redis);
  });

  describe('issuePreviewToken', () => {
    it('mints a `preview_`-prefixed token and stores filter with 5-minute TTL', async () => {
      const filter: BatchDeletePreviewInput = {
        personalityId: 'persona-1',
        personaId: 'me',
        timeframe: '7d',
      };
      const token = await service.issuePreviewToken('user-123', filter);

      expect(token).toMatch(/^preview_[A-Za-z0-9_-]{16,64}$/);
      expect(redis.setex).toHaveBeenCalledWith(
        `${REDIS_KEY_PREFIXES.MEMORY_PREVIEW_TOKEN}user-123:${token}`,
        300,
        expect.any(String)
      );
      const [, , raw] = (redis.setex as unknown as { mock: { calls: unknown[][] } }).mock
        .calls[0] as [string, number, string];
      const parsed = JSON.parse(raw) as { filter: BatchDeletePreviewInput; issuedAt: string };
      expect(parsed.filter).toEqual(filter);
      expect(parsed.issuedAt).toBe('2026-05-26T12:00:00.000Z');
    });

    it('produces a unique token per call', async () => {
      const filter: BatchDeletePreviewInput = { personalityId: 'p' };
      const t1 = await service.issuePreviewToken('user-a', filter);
      const t2 = await service.issuePreviewToken('user-a', filter);
      expect(t1).not.toBe(t2);
    });
  });

  describe('consumePreviewToken', () => {
    it('returns the bound filter and deletes the key atomically', async () => {
      const filter: BatchDeletePreviewInput = { personalityId: 'p', timeframe: '7d' };
      const stored = JSON.stringify({ filter, issuedAt: '2026-05-26T12:00:00.000Z' });
      (
        redis.getdel as unknown as { mockResolvedValueOnce: (v: unknown) => void }
      ).mockResolvedValueOnce(stored);

      const result = await service.consumePreviewToken('user-a', 'preview_xyz0123456789abc');

      expect(result).toEqual(filter);
      expect(redis.getdel).toHaveBeenCalledWith(
        `${REDIS_KEY_PREFIXES.MEMORY_PREVIEW_TOKEN}user-a:preview_xyz0123456789abc`
      );
    });

    it('returns null when the token does not exist', async () => {
      const result = await service.consumePreviewToken('user-a', 'preview_missing0000000000');
      expect(result).toBeNull();
    });

    it('returns null and logs when payload JSON is malformed', async () => {
      (
        redis.getdel as unknown as { mockResolvedValueOnce: (v: unknown) => void }
      ).mockResolvedValueOnce('not-json');
      const result = await service.consumePreviewToken('user-a', 'preview_bad000000000000000');
      expect(result).toBeNull();
    });

    it('cannot be replayed — a second consume sees null', async () => {
      const stored = JSON.stringify({
        filter: { personalityId: 'p' },
        issuedAt: '2026-05-26T12:00:00.000Z',
      });
      const mock = redis.getdel as unknown as {
        mockResolvedValueOnce: (v: unknown) => void;
      };
      mock.mockResolvedValueOnce(stored);
      mock.mockResolvedValueOnce(null);

      const first = await service.consumePreviewToken('user-a', 'preview_aaaaaaaaaaaaaaaa');
      const second = await service.consumePreviewToken('user-a', 'preview_aaaaaaaaaaaaaaaa');

      expect(first).not.toBeNull();
      expect(second).toBeNull();
    });

    it('is namespaced by userId — token issued for user A misses for user B', async () => {
      const result = await service.consumePreviewToken('user-b', 'preview_stolen000000000000');
      expect(result).toBeNull();
      expect(redis.getdel).toHaveBeenCalledWith(
        `${REDIS_KEY_PREFIXES.MEMORY_PREVIEW_TOKEN}user-b:preview_stolen000000000000`
      );
    });
  });

  describe('issuePurgeToken', () => {
    it('mints a `purge_`-prefixed token and stores personalityId with 5-minute TTL', async () => {
      const token = await service.issuePurgeToken('user-123', 'persona-1');

      expect(token).toMatch(/^purge_[A-Za-z0-9_-]{16,64}$/);
      expect(redis.setex).toHaveBeenCalledWith(
        `${REDIS_KEY_PREFIXES.MEMORY_PURGE_TOKEN}user-123:${token}`,
        300,
        expect.any(String)
      );
    });
  });

  describe('consumePurgeToken', () => {
    it('returns the bound personalityId', async () => {
      const stored = JSON.stringify({
        personalityId: 'persona-1',
        issuedAt: '2026-05-26T12:00:00.000Z',
      });
      (
        redis.getdel as unknown as { mockResolvedValueOnce: (v: unknown) => void }
      ).mockResolvedValueOnce(stored);

      const result = await service.consumePurgeToken('user-a', 'purge_xyz0123456789abc');
      expect(result).toEqual({ personalityId: 'persona-1' });
    });

    it('returns null on miss', async () => {
      const result = await service.consumePurgeToken('user-a', 'purge_missing000000000000');
      expect(result).toBeNull();
    });
  });
});
