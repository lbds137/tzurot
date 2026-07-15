/**
 * Tests for MemoryActionTokenService
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import { MemoryActionTokenService } from './MemoryActionTokenService.js';
import { REDIS_KEY_PREFIXES } from '@tzurot/common-types/constants/queue';
import { type BatchDeletePreviewInput } from '@tzurot/common-types/schemas/api/memory';

function createMockRedis(): Redis {
  return {
    setex: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue(null),
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

      const result = await service.consumePreviewToken('user-a', 'preview_test0000test0002');

      expect(result).toEqual(filter);
      expect(redis.getdel).toHaveBeenCalledWith(
        `${REDIS_KEY_PREFIXES.MEMORY_PREVIEW_TOKEN}user-a:preview_test0000test0002`
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

  describe('peekPreviewToken', () => {
    it('returns the bound filter WITHOUT consuming the key', async () => {
      const filter: BatchDeletePreviewInput = { personalityId: 'p', timeframe: '7d' };
      const stored = JSON.stringify({ filter, issuedAt: '2026-05-26T12:00:00.000Z' });
      (
        redis.get as unknown as { mockResolvedValueOnce: (v: unknown) => void }
      ).mockResolvedValueOnce(stored);

      const result = await service.peekPreviewToken('user-a', 'preview_xyz000000test0000');

      expect(result).toEqual(filter);
      expect(redis.get).toHaveBeenCalledWith(
        `${REDIS_KEY_PREFIXES.MEMORY_PREVIEW_TOKEN}user-a:preview_xyz000000test0000`
      );
      // Critically, peek must NOT call getdel — that's the load-bearing
      // difference vs consume.
      expect(redis.getdel).not.toHaveBeenCalled();
    });

    it('returns null on miss (no key present)', async () => {
      const result = await service.peekPreviewToken('user-a', 'preview_missing000000test');
      expect(result).toBeNull();
    });

    it('returns null on malformed payload', async () => {
      (
        redis.get as unknown as { mockResolvedValueOnce: (v: unknown) => void }
      ).mockResolvedValueOnce('not-json');
      const result = await service.peekPreviewToken('user-a', 'preview_bad0000000000test');
      expect(result).toBeNull();
    });

    it('can be called repeatedly — non-destructive', async () => {
      const filter: BatchDeletePreviewInput = { personalityId: 'p' };
      const stored = JSON.stringify({ filter, issuedAt: '2026-05-26T12:00:00.000Z' });
      const mock = redis.get as unknown as { mockResolvedValue: (v: unknown) => void };
      mock.mockResolvedValue(stored);

      const a = await service.peekPreviewToken('user-a', 'preview_aaaaaaaaaaaaaaaa');
      const b = await service.peekPreviewToken('user-a', 'preview_aaaaaaaaaaaaaaaa');

      expect(a).toEqual(filter);
      expect(b).toEqual(filter);
    });
  });

  describe('peekPurgeToken', () => {
    it('returns the bound personalityId WITHOUT consuming the key', async () => {
      const stored = JSON.stringify({
        personalityId: 'persona-1',
        issuedAt: '2026-05-26T12:00:00.000Z',
      });
      (
        redis.get as unknown as { mockResolvedValueOnce: (v: unknown) => void }
      ).mockResolvedValueOnce(stored);

      const result = await service.peekPurgeToken('user-a', 'purge_xyz0123456789abc');

      expect(result).toEqual({ personalityId: 'persona-1' });
      expect(redis.getdel).not.toHaveBeenCalled();
    });

    it('returns null on miss', async () => {
      const result = await service.peekPurgeToken('user-a', 'purge_missing000000000000');
      expect(result).toBeNull();
    });

    it('returns null on malformed payload', async () => {
      (
        redis.get as unknown as { mockResolvedValueOnce: (v: unknown) => void }
      ).mockResolvedValueOnce('not-json');
      const result = await service.peekPurgeToken('user-a', 'purge_bad000000000000000');
      expect(result).toBeNull();
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

    it('returns null and logs when payload JSON is malformed', async () => {
      (
        redis.getdel as unknown as { mockResolvedValueOnce: (v: unknown) => void }
      ).mockResolvedValueOnce('not-json');
      const result = await service.consumePurgeToken('user-a', 'purge_bad000000000000000');
      expect(result).toBeNull();
    });

    it('cannot be replayed — a second consume sees null', async () => {
      const stored = JSON.stringify({
        personalityId: 'persona-1',
        issuedAt: '2026-05-26T12:00:00.000Z',
      });
      const mock = redis.getdel as unknown as {
        mockResolvedValueOnce: (v: unknown) => void;
      };
      mock.mockResolvedValueOnce(stored);
      mock.mockResolvedValueOnce(null);

      const first = await service.consumePurgeToken('user-a', 'purge_aaaaaaaaaaaaaaaa');
      const second = await service.consumePurgeToken('user-a', 'purge_aaaaaaaaaaaaaaaa');

      expect(first).not.toBeNull();
      expect(second).toBeNull();
    });

    it('is namespaced by userId — token issued for user A misses for user B', async () => {
      const result = await service.consumePurgeToken('user-b', 'purge_stolen000000000000');
      expect(result).toBeNull();
      expect(redis.getdel).toHaveBeenCalledWith(
        `${REDIS_KEY_PREFIXES.MEMORY_PURGE_TOKEN}user-b:purge_stolen000000000000`
      );
    });
  });

  describe('issuePreviewToken — Redis errors propagate', () => {
    it('propagates setex failures (handled by Express global error handler)', async () => {
      const err = new Error('Redis connection lost');
      (
        redis.setex as unknown as { mockRejectedValueOnce: (v: unknown) => void }
      ).mockRejectedValueOnce(err);

      await expect(service.issuePreviewToken('user-a', { personalityId: 'p' })).rejects.toThrow(
        'Redis connection lost'
      );
    });
  });

  describe('account delete tokens', () => {
    it('mints an `acctdel_`-prefixed token under the account:delete key with 5-minute TTL', async () => {
      const token = await service.issueAccountDeleteToken('user-123');

      expect(token).toMatch(/^acctdel_[A-Za-z0-9_-]{16,64}$/);
      expect(redis.setex).toHaveBeenCalledWith(
        `${REDIS_KEY_PREFIXES.ACCOUNT_DELETE_TOKEN}user-123:${token}`,
        300,
        expect.any(String)
      );
    });

    it('peek reads without consuming; consume uses atomic getdel', async () => {
      (
        redis.get as unknown as { mockResolvedValueOnce: (v: unknown) => void }
      ).mockResolvedValueOnce(JSON.stringify({ issuedAt: 'now' }));
      expect(await service.peekAccountDeleteToken('user-123', 'acctdel_tok')).toBe(true);
      expect(redis.getdel).not.toHaveBeenCalled();

      (
        redis.getdel as unknown as { mockResolvedValueOnce: (v: unknown) => void }
      ).mockResolvedValueOnce(JSON.stringify({ issuedAt: 'now' }));
      expect(await service.consumeAccountDeleteToken('user-123', 'acctdel_tok')).toBe(true);
      expect(redis.getdel).toHaveBeenCalledWith(
        `${REDIS_KEY_PREFIXES.ACCOUNT_DELETE_TOKEN}user-123:acctdel_tok`
      );
    });

    it('missing tokens peek and consume as false', async () => {
      expect(await service.peekAccountDeleteToken('user-123', 'acctdel_missing')).toBe(false);
      expect(await service.consumeAccountDeleteToken('user-123', 'acctdel_missing')).toBe(false);
    });
  });
});
