/**
 * Tests for ModelCatalogRefresher — the scheduled writer that keeps the
 * OpenRouter catalog present in Redis instead of relying on request traffic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { INTERVALS } from '@tzurot/common-types/constants/timing';
import type { OpenRouterModel } from '@tzurot/common-types/types/ai';
import {
  createModelCatalogRefresher,
  CATALOG_REFRESH_INTERVAL_MS,
} from './ModelCatalogRefresher.js';
import { OpenRouterModelCache } from './OpenRouterModelCache.js';

/** Minimal catalog row — the seam test only needs one identifiable entry. */
const sampleModel = {
  id: 'anthropic/claude-sonnet-4',
  name: 'Claude Sonnet 4',
  context_length: 200000,
  architecture: { input_modalities: ['text'], output_modalities: ['text'] },
  pricing: { prompt: '0.000003', completion: '0.000015' },
  top_provider: { context_length: 200000 },
  supported_parameters: ['temperature'],
  created: 1700000000,
} as unknown as OpenRouterModel;

describe('ModelCatalogRefresher', () => {
  let refreshFromSource: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    refreshFromSource = vi.fn().mockResolvedValue(42);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('leaves room for two retries before the cache TTL expires', () => {
    // The interval and the TTL are only safe as a ratio, asserted against the
    // TTL constant rather than a literal so a TTL change cannot silently
    // reopen the expiry gap.
    //
    // STRICT `<`, not `<=`: at an exact boundary the retry write lands ON the
    // expiry instant — and because each tick's setex only lands after its
    // fetch returns, it actually trails it. The margin has to be real.
    const ttlMs = INTERVALS.OPENROUTER_MODELS_TTL * 1000;
    expect(CATALOG_REFRESH_INTERVAL_MS * 2).toBeLessThan(ttlMs);
    expect(CATALOG_REFRESH_INTERVAL_MS * 3).toBeLessThanOrEqual(ttlMs);
  });

  it('warms the catalog shortly after startup', async () => {
    const refresher = createModelCatalogRefresher({ refreshFromSource } as never);
    refresher.start();

    expect(refreshFromSource).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(15_000);

    // The startup run is what makes this restart-friendly: a deploy warms the
    // catalog immediately rather than waiting out a full interval.
    expect(refreshFromSource).toHaveBeenCalledOnce();
    refresher.stop();
  });

  it('keeps refreshing on the interval', async () => {
    const refresher = createModelCatalogRefresher({ refreshFromSource } as never);
    refresher.start();

    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(CATALOG_REFRESH_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(CATALOG_REFRESH_INTERVAL_MS);

    expect(refreshFromSource).toHaveBeenCalledTimes(3);
    refresher.stop();
  });

  it('survives a failing refresh and retries on the next tick', async () => {
    // The scheduler fires the cycle unawaited, so an escaping rejection would
    // become an unhandled rejection and take the process down under the
    // 'shutdown' rejection policy — a catalog outage must not do that.
    refreshFromSource
      .mockRejectedValueOnce(new Error('OpenRouter unreachable'))
      .mockResolvedValueOnce(42);

    const refresher = createModelCatalogRefresher({ refreshFromSource } as never);
    refresher.start();

    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(CATALOG_REFRESH_INTERVAL_MS);

    expect(refreshFromSource).toHaveBeenCalledTimes(2);
    refresher.stop();
  });

  it('drives a real OpenRouterModelCache through to the Redis write', async () => {
    // Wiring/seam test per 02-code-standards.md: every other test here stubs
    // refreshFromSource, so nothing proves the scheduler and the cache
    // actually compose. Only the external boundary (fetch, Redis) is mocked —
    // a signature drift that structural typing lets past the Pick<> parameter
    // would otherwise be caught by tsc alone, never at runtime.
    const setex = vi.fn().mockResolvedValue('OK');
    const redis = { get: vi.fn(), setex, del: vi.fn() } as unknown as Redis;
    const cache = new OpenRouterModelCache(redis);

    // stubGlobal, not a bare assignment: `vi.restoreAllMocks()` only undoes
    // spies, so a raw `global.fetch = …` would leak into whatever test is
    // added after this one. `unstubAllGlobals` in afterEach cleans it up.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [sampleModel] }),
      })
    );

    const refresher = createModelCatalogRefresher(cache);
    refresher.start();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/models',
      expect.objectContaining({ method: 'GET' })
    );
    // The sentinel model reaches Redis — the scheduler's tick really did carry
    // fetched data all the way to the write.
    expect(setex).toHaveBeenCalledWith(
      'openrouter:models',
      INTERVALS.OPENROUTER_MODELS_TTL,
      JSON.stringify([sampleModel])
    );
    refresher.stop();
  });

  it('stops refreshing once stopped', async () => {
    const refresher = createModelCatalogRefresher({ refreshFromSource } as never);
    refresher.start();
    await vi.advanceTimersByTimeAsync(15_000);
    refresher.stop();

    await vi.advanceTimersByTimeAsync(CATALOG_REFRESH_INTERVAL_MS * 3);

    expect(refreshFromSource).toHaveBeenCalledOnce();
  });
});
