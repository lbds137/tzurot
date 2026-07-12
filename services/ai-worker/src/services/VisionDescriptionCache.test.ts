/**
 * Unit Tests for VisionDescriptionCache
 *
 * Two-tier cache: a model-AGNOSTIC canonical success key (tier-promoted) + a
 * per-model negative cache. (L2 PostgreSQL was removed in beta.110.)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import { VisionDescriptionCache, shouldPromoteCanonical } from './VisionDescriptionCache.js';
import { ApiErrorCategory } from '@tzurot/common-types/constants/error';
import { REDIS_KEY_PREFIXES } from '@tzurot/common-types/constants/queue';
import { INTERVALS } from '@tzurot/common-types/constants/timing';

// Silence the real pino logger; nothing here asserts on log output.
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

const CANON = REDIS_KEY_PREFIXES.VISION_CANONICAL;
const FAIL = REDIS_KEY_PREFIXES.VISION_FAILURE;

function canonicalEntry(description: string, tier: number, tsOffsetMs = 0): string {
  return JSON.stringify({ description, model: 'm', tier, ts: Date.now() + tsOffsetMs });
}

describe('shouldPromoteCanonical (pure promotion decision)', () => {
  const now = 1_000_000_000;
  it('promotes when nothing is cached', () => {
    expect(shouldPromoteCanonical(null, 1, now)).toBe(true);
  });
  it('promotes an equal-or-higher tier (paid over free, or same-tier refresh)', () => {
    expect(shouldPromoteCanonical({ tier: 1, ts: now }, 2, now)).toBe(true);
    expect(shouldPromoteCanonical({ tier: 2, ts: now }, 2, now)).toBe(true);
  });
  it('does NOT promote a lower tier over a higher one (no race to the bottom)', () => {
    expect(shouldPromoteCanonical({ tier: 2, ts: now }, 1, now)).toBe(false);
  });
  it('promotes over a stale (>24h) entry regardless of tier', () => {
    const staleTs = now - 25 * 60 * 60 * 1000;
    expect(shouldPromoteCanonical({ tier: 2, ts: staleTs }, 1, now)).toBe(true);
  });
});

describe('VisionDescriptionCache', () => {
  let mockRedis: {
    setex: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    exists: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
  };
  let cache: VisionDescriptionCache;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis = {
      setex: vi.fn().mockResolvedValue('OK'),
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      exists: vi.fn().mockResolvedValue(0),
      del: vi.fn().mockResolvedValue(1),
    };
    cache = new VisionDescriptionCache(mockRedis as unknown as Redis);
  });

  describe('single-flight inflight marker', () => {
    const options = { attachmentId: 'att-1', url: 'https://cdn.example/img.png' };

    it('acquires with NX + TTL and reports winner on OK', async () => {
      mockRedis.set.mockResolvedValueOnce('OK');
      await expect(cache.tryAcquireInflight(options)).resolves.toBe(true);
      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringContaining('vision:inflight:'),
        '1',
        'EX',
        expect.any(Number),
        'NX'
      );
    });

    it('reports loser when the marker already exists (NX returns null)', async () => {
      mockRedis.set.mockResolvedValueOnce(null);
      await expect(cache.tryAcquireInflight(options)).resolves.toBe(false);
    });

    it('fails OPEN on a Redis error — caller proceeds as winner (no coalescing)', async () => {
      mockRedis.set.mockRejectedValueOnce(new Error('redis down'));
      await expect(cache.tryAcquireInflight(options)).resolves.toBe(true);
    });

    it('isInflight reflects EXISTS and fails open to false on error', async () => {
      mockRedis.exists.mockResolvedValueOnce(1);
      await expect(cache.isInflight(options)).resolves.toBe(true);
      mockRedis.exists.mockRejectedValueOnce(new Error('redis down'));
      await expect(cache.isInflight(options)).resolves.toBe(false);
    });

    it('releaseInflight deletes the marker and never throws', async () => {
      await cache.releaseInflight(options);
      expect(mockRedis.del).toHaveBeenCalledWith(expect.stringContaining('vision:inflight:'));
      mockRedis.del.mockRejectedValueOnce(new Error('redis down'));
      await expect(cache.releaseInflight(options)).resolves.toBeUndefined();
    });
  });

  describe('store / get — canonical (model-agnostic) success cache', () => {
    it('stores a canonical JSON entry under the model-agnostic key', async () => {
      await cache.store({ attachmentId: '123', url: 'u', model: 'qwen/qwen3.7-plus' }, 'a cat');
      expect(mockRedis.setex).toHaveBeenCalledWith(
        `${CANON}id:123`,
        INTERVALS.VISION_DESCRIPTION_TTL,
        expect.stringContaining('"description":"a cat"')
      );
    });

    it('serves a paid model’s description to a DIFFERENT (free) model — the free-tier fix', async () => {
      // A paid model already cached the description (canonical, model-agnostic).
      mockRedis.get.mockResolvedValueOnce(canonicalEntry('a cat on a keyboard', 2));
      // A free-tier read hits the SAME canonical key and gets it — no re-describe.
      const result = await cache.get({ attachmentId: '123', url: 'u', model: 'openrouter/free' });
      expect(result).toBe('a cat on a keyboard');
    });

    it('returns null on miss', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      expect(await cache.get({ attachmentId: '123', url: 'u' })).toBeNull();
    });

    it('returns null (not a throw) on a corrupt canonical entry', async () => {
      mockRedis.get.mockResolvedValueOnce('not json');
      expect(await cache.get({ attachmentId: '123', url: 'u' })).toBeNull();
    });

    it('returns null on a valid-JSON entry with the wrong shape (e.g. a legacy bare string)', async () => {
      // Parses fine but has none of the CanonicalEntry fields — treated as absent.
      mockRedis.get.mockResolvedValueOnce(JSON.stringify({ foo: 1 }));
      expect(await cache.get({ attachmentId: '123', url: 'u' })).toBeNull();
    });

    it('uses the SAME canonical key for any model (model-agnostic)', async () => {
      await cache.store({ attachmentId: '123', url: 'u', model: 'qwen/qwen3.7-plus' }, 'a');
      await cache.store({ attachmentId: '123', url: 'u', model: 'openai/gpt-4o' }, 'b');
      expect(mockRedis.setex.mock.calls[0][0]).toBe(`${CANON}id:123`);
      expect(mockRedis.setex.mock.calls[1][0]).toBe(`${CANON}id:123`);
    });
  });

  describe('store — tier promotion', () => {
    it('does NOT overwrite a paid (tier 2) description with a free (tier 1) one', async () => {
      mockRedis.get.mockResolvedValueOnce(canonicalEntry('paid desc', 2));
      await cache.store(
        { attachmentId: '123', url: 'u', model: 'openrouter/free' },
        'weak free desc'
      );
      expect(mockRedis.setex).not.toHaveBeenCalled();
    });

    it('treats an empty-string model as the LOWEST tier (fail-safe, cannot clobber paid)', async () => {
      // `model: ''` satisfies the `string` type but must not claim PAID
      // (isFreeModel('') is false) — the runtime backstop maps it to FREE.
      mockRedis.get.mockResolvedValueOnce(canonicalEntry('paid desc', 2));
      await cache.store({ attachmentId: '123', url: 'u', model: '' }, 'unknown-origin desc');
      expect(mockRedis.setex).not.toHaveBeenCalled();
    });

    it('promotes a paid (tier 2) description over an existing free (tier 1) one', async () => {
      mockRedis.get.mockResolvedValueOnce(canonicalEntry('free desc', 1));
      await cache.store({ attachmentId: '123', url: 'u', model: 'qwen/qwen3.7-plus' }, 'paid desc');
      expect(mockRedis.setex).toHaveBeenCalledWith(
        `${CANON}id:123`,
        INTERVALS.VISION_DESCRIPTION_TTL,
        expect.stringContaining('"description":"paid desc"')
      );
    });
  });

  describe('storeFailure (per-model, per-category cache policy)', () => {
    it('caches AUTHENTICATION failures with SHORT TTL under the per-model failure key', async () => {
      await cache.storeFailure({
        attachmentId: '123',
        url: 'u',
        model: 'openrouter/free',
        category: ApiErrorCategory.AUTHENTICATION,
      });
      const [key, ttl, value] = mockRedis.setex.mock.calls[0];
      expect(key).toBe(`${FAIL}openrouter_free:id:123`); // per-model — a paid model isn't blocked
      expect(ttl).toBe(INTERVALS.VISION_FAILURE_TTL_SHORT);
      expect(value).toContain(`"category":"${ApiErrorCategory.AUTHENTICATION}"`);
    });

    it('caches CONTENT_POLICY + MEDIA_NOT_FOUND with LONG TTL, RATE_LIMIT with default', async () => {
      const cases: [ApiErrorCategory, number][] = [
        [ApiErrorCategory.CONTENT_POLICY, INTERVALS.VISION_FAILURE_TTL_LONG],
        [ApiErrorCategory.MEDIA_NOT_FOUND, INTERVALS.VISION_FAILURE_TTL_LONG],
        [ApiErrorCategory.RATE_LIMIT, INTERVALS.VISION_FAILURE_TTL],
        [ApiErrorCategory.QUOTA_EXCEEDED, INTERVALS.VISION_FAILURE_TTL_SHORT],
      ];
      for (const [category, expectedTtl] of cases) {
        mockRedis.setex.mockClear();
        await cache.storeFailure({ attachmentId: '123', url: 'u', category });
        expect(mockRedis.setex.mock.calls[0][1]).toBe(expectedTtl);
      }
    });

    it('embeds an ISO cachedAt timestamp', async () => {
      await cache.storeFailure({
        attachmentId: '123',
        url: 'u',
        category: ApiErrorCategory.AUTHENTICATION,
      });
      const parsed = JSON.parse(mockRedis.setex.mock.calls[0][2]);
      expect(typeof parsed.cachedAt).toBe('string');
      expect(() => new Date(parsed.cachedAt).toISOString()).not.toThrow();
    });

    it('falls back to a URL-hash key when attachmentId is missing', async () => {
      await cache.storeFailure({
        url: 'https://x/i.png?ex=abc',
        category: ApiErrorCategory.AUTHENTICATION,
      });
      expect(mockRedis.setex.mock.calls[0][0]).toMatch(new RegExp(`^${FAIL}url:[a-f0-9]+$`));
    });

    it('does not throw on Redis errors', async () => {
      mockRedis.setex.mockRejectedValueOnce(new Error('Redis down'));
      await expect(
        cache.storeFailure({
          attachmentId: '123',
          url: 'u',
          category: ApiErrorCategory.AUTHENTICATION,
        })
      ).resolves.toBeUndefined();
    });
  });

  describe('wiring/seam: real store→promote→get chain over a stateful Redis fake', () => {
    // Replays the production bug scenario end-to-end with only Redis mocked:
    // a paid model describes an image; a free-tier request for the SAME image
    // must read that description; a later free-model store must not clobber it.
    it('free tier reads the paid description; a weaker store cannot clobber it', async () => {
      const kv = new Map<string, string>();
      const statefulRedis = {
        get: vi.fn((key: string) => Promise.resolve(kv.get(key) ?? null)),
        setex: vi.fn((key: string, _ttl: number, value: string) => {
          kv.set(key, value);
          return Promise.resolve('OK');
        }),
      };
      const seamCache = new VisionDescriptionCache(statefulRedis as unknown as Redis);
      const image = {
        attachmentId: '1522411708520333492',
        url: 'https://cdn.discordapp.com/a.png',
      };

      // 1. Paid model describes and stores.
      await seamCache.store({ ...image, model: 'qwen/qwen3.7-plus' }, 'a cat on a keyboard');
      // 2. Free-tier request reads the SAME image — gets the paid description.
      expect(await seamCache.get({ ...image, model: 'openrouter/free' })).toBe(
        'a cat on a keyboard'
      );
      // 3. A weaker (free) store cannot clobber it...
      await seamCache.store({ ...image, model: 'openrouter/free' }, 'weak free description');
      expect(await seamCache.get(image)).toBe('a cat on a keyboard');
      // 4. ...but an equal-tier (paid) store refreshes it.
      await seamCache.store({ ...image, model: 'anthropic/claude-sonnet-4' }, 'better description');
      expect(await seamCache.get(image)).toBe('better description');
    });
  });

  describe('getFailure', () => {
    it('returns null when no entry cached', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      expect(await cache.getFailure({ attachmentId: '123', url: 'u' })).toBeNull();
    });

    it('returns the category + cachedAt on hit', async () => {
      const cachedAt = '2026-04-28T18:22:42.000Z';
      mockRedis.get.mockResolvedValueOnce(
        JSON.stringify({ category: ApiErrorCategory.AUTHENTICATION, cachedAt })
      );
      expect(await cache.getFailure({ attachmentId: '123', url: 'u' })).toEqual({
        category: ApiErrorCategory.AUTHENTICATION,
        cachedAt,
      });
    });

    it('returns null on Redis errors (fail open)', async () => {
      mockRedis.get.mockRejectedValueOnce(new Error('Redis down'));
      expect(await cache.getFailure({ attachmentId: '123', url: 'u' })).toBeNull();
    });

    it('reads the per-model failure key', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      await cache.getFailure({ attachmentId: '123', url: 'u', model: 'openrouter/free' });
      expect(mockRedis.get.mock.calls[0][0]).toBe(`${FAIL}openrouter_free:id:123`);
    });
  });
});
