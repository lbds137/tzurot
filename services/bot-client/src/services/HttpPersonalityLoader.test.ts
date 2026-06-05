import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockServiceClient = {
  loadPersonalityInternal: vi.fn(),
};

vi.mock('../utils/gatewayClients.js', () => ({
  getServiceClient: () => mockServiceClient,
}));

import { TIMEOUTS } from '@tzurot/common-types';
import { HttpPersonalityLoader, NEGATIVE_TTL_MS } from './HttpPersonalityLoader.js';

const PERSONALITY = { id: 'pers-1', name: 'Lila', slug: 'lila' };

const ok = <T>(data: T): { ok: true; data: T } => ({ ok: true, data });
const err = (status: number): { ok: false; error: string; status: number } => ({
  ok: false,
  error: 'boom',
  status,
});

describe('HttpPersonalityLoader', () => {
  let loader: HttpPersonalityLoader;
  let clock: number;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Nonzero start: lru-cache stores entry start times from perf.now() and
    // treats 0 as "no TTL recorded", which would make entries immortal.
    clock = 1_000_000;
    // lru-cache snapshots performance.now at module load — fake timers can't
    // advance its TTLs, so the loader takes an injectable clock instead.
    loader = new HttpPersonalityLoader({ now: () => clock });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches on miss and serves subsequent hits from the positive cache', async () => {
    mockServiceClient.loadPersonalityInternal.mockResolvedValue(ok({ personality: PERSONALITY }));

    const first = await loader.loadPersonality('lila', 'user-1');
    const second = await loader.loadPersonality('lila', 'user-1');

    expect(first?.id).toBe('pers-1');
    expect(second?.id).toBe('pers-1');
    expect(mockServiceClient.loadPersonalityInternal).toHaveBeenCalledTimes(1);
    expect(mockServiceClient.loadPersonalityInternal).toHaveBeenCalledWith({
      nameOrId: 'lila',
      userId: 'user-1',
    });
  });

  it('caches definitive misses (negative cache) — no repeat hop per probe', async () => {
    mockServiceClient.loadPersonalityInternal.mockResolvedValue(ok({ personality: null }));

    expect(await loader.loadPersonality('everyone', 'user-1')).toBeNull();
    expect(await loader.loadPersonality('everyone', 'user-1')).toBeNull();

    expect(mockServiceClient.loadPersonalityInternal).toHaveBeenCalledTimes(1);
  });

  it('expires positive entries after the 5-minute TTL and re-fetches', async () => {
    mockServiceClient.loadPersonalityInternal.mockResolvedValue(ok({ personality: PERSONALITY }));
    await loader.loadPersonality('lila', 'user-1');

    clock += TIMEOUTS.CACHE_TTL + 1000;
    await loader.loadPersonality('lila', 'user-1');

    expect(mockServiceClient.loadPersonalityInternal).toHaveBeenCalledTimes(2);
  });

  it('expires negative entries after 60s so new personalities appear quickly', async () => {
    mockServiceClient.loadPersonalityInternal.mockResolvedValue(ok({ personality: null }));
    await loader.loadPersonality('soon-to-exist', 'user-1');

    clock += NEGATIVE_TTL_MS + 1000;
    mockServiceClient.loadPersonalityInternal.mockResolvedValue(ok({ personality: PERSONALITY }));

    const result = await loader.loadPersonality('soon-to-exist', 'user-1');
    expect(result?.id).toBe('pers-1');
    expect(mockServiceClient.loadPersonalityInternal).toHaveBeenCalledTimes(2);
  });

  it('does NOT negative-cache transport errors (a gateway blip must not blind routing)', async () => {
    mockServiceClient.loadPersonalityInternal.mockResolvedValueOnce(err(503));
    expect(await loader.loadPersonality('lila', 'user-1')).toBeNull();

    mockServiceClient.loadPersonalityInternal.mockResolvedValueOnce(
      ok({ personality: PERSONALITY })
    );
    const retry = await loader.loadPersonality('lila', 'user-1');

    expect(retry?.id).toBe('pers-1');
    expect(mockServiceClient.loadPersonalityInternal).toHaveBeenCalledTimes(2);
  });

  it('keys the cache by userId — access control results are not shared across users', async () => {
    // user-1 can see it; user-2 cannot (server-side access control).
    mockServiceClient.loadPersonalityInternal
      .mockResolvedValueOnce(ok({ personality: PERSONALITY }))
      .mockResolvedValueOnce(ok({ personality: null }));

    expect(await loader.loadPersonality('lila', 'user-1')).not.toBeNull();
    expect(await loader.loadPersonality('lila', 'user-2')).toBeNull();
    // And the cached answers stay per-user:
    expect(await loader.loadPersonality('lila', 'user-1')).not.toBeNull();
    expect(await loader.loadPersonality('lila', 'user-2')).toBeNull();

    expect(mockServiceClient.loadPersonalityInternal).toHaveBeenCalledTimes(2);
  });

  it('keys case-insensitively on the name', async () => {
    mockServiceClient.loadPersonalityInternal.mockResolvedValue(ok({ personality: PERSONALITY }));

    await loader.loadPersonality('Lila', 'user-1');
    await loader.loadPersonality('lila', 'user-1');

    expect(mockServiceClient.loadPersonalityInternal).toHaveBeenCalledTimes(1);
  });

  it('invalidatePersonality clears both tiers (pub/sub-driven)', async () => {
    mockServiceClient.loadPersonalityInternal.mockResolvedValue(ok({ personality: PERSONALITY }));
    await loader.loadPersonality('lila', 'user-1');

    loader.invalidatePersonality('pers-1');
    await loader.loadPersonality('lila', 'user-1');

    expect(mockServiceClient.loadPersonalityInternal).toHaveBeenCalledTimes(2);
  });

  it('invalidateAll clears negative entries too', async () => {
    mockServiceClient.loadPersonalityInternal.mockResolvedValue(ok({ personality: null }));
    await loader.loadPersonality('ghost', 'user-1');

    loader.invalidateAll();
    mockServiceClient.loadPersonalityInternal.mockResolvedValue(ok({ personality: PERSONALITY }));

    const result = await loader.loadPersonality('ghost', 'user-1');
    expect(result?.id).toBe('pers-1');
  });
});
