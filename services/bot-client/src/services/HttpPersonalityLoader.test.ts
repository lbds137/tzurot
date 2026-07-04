import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockServiceClient = {
  loadPersonalityInternal: vi.fn(),
};

vi.mock('../utils/gatewayClients.js', () => ({
  getServiceClient: () => mockServiceClient,
}));

import { TIMEOUTS } from '@tzurot/common-types/constants/timing';
import { InfraError, GatewayClientError } from '@tzurot/clients';
import { HttpPersonalityLoader, NEGATIVE_TTL_MS } from './HttpPersonalityLoader.js';

const PERSONALITY = { id: 'pers-1', name: 'Lila', slug: 'lila' };

const ok = <T>(data: T): { ok: true; data: T } => ({ ok: true, data });
// `kind` mirrors the real GatewayResult invariant (status>0 ⟺ 'http') so the
// strict helpers classify correctly: a 5xx / non-http → InfraError, a non-404
// 4xx → GatewayClientError.
const err = (
  status: number
): { ok: false; kind: 'http' | 'network'; error: string; status: number } => ({
  ok: false,
  kind: status > 0 ? 'http' : 'network',
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

  it('loadPersonalityStrict throws InfraError on an infra failure (5xx) — not a silent null', async () => {
    mockServiceClient.loadPersonalityInternal.mockResolvedValue(err(503));
    await expect(loader.loadPersonalityStrict('lila', 'user-1')).rejects.toThrow(InfraError);
  });

  it('loadPersonalityStrict throws GatewayClientError on a non-404 4xx', async () => {
    mockServiceClient.loadPersonalityInternal.mockResolvedValue(err(403));
    await expect(loader.loadPersonalityStrict('lila', 'user-1')).rejects.toThrow(
      GatewayClientError
    );
  });

  it('loadPersonalityStrict returns null ONLY for a genuine miss (200 with personality:null)', async () => {
    mockServiceClient.loadPersonalityInternal.mockResolvedValue(ok({ personality: null }));
    expect(await loader.loadPersonalityStrict('ghost', 'user-1')).toBeNull();
  });

  it('loadPersonalityStrict does NOT negative-cache an infra failure (throw happens first)', async () => {
    mockServiceClient.loadPersonalityInternal.mockResolvedValueOnce(err(503));
    await expect(loader.loadPersonalityStrict('lila', 'user-1')).rejects.toThrow(InfraError);
    mockServiceClient.loadPersonalityInternal.mockResolvedValueOnce(
      ok({ personality: PERSONALITY })
    );
    expect((await loader.loadPersonalityStrict('lila', 'user-1'))?.id).toBe('pers-1');
    expect(mockServiceClient.loadPersonalityInternal).toHaveBeenCalledTimes(2);
  });

  it('loadPersonalityStrict throws InfraError on a NETWORK failure (status 0, kind network)', async () => {
    // A network/timeout failure carries status 0 / kind!=='http' — still infra,
    // never a 404. Documents that "network failure ≠ not found" like the 5xx case.
    mockServiceClient.loadPersonalityInternal.mockResolvedValue(err(0));
    await expect(loader.loadPersonalityStrict('lila', 'user-1')).rejects.toThrow(InfraError);
  });

  it('loadPersonality (lenient wrapper) collapses an infra failure to null for routing', async () => {
    mockServiceClient.loadPersonalityInternal.mockResolvedValue(err(503));
    expect(await loader.loadPersonality('lila', 'user-1')).toBeNull();
  });

  it('loadPersonality (lenient wrapper) re-throws a non-gateway error (not an infra failure)', async () => {
    // A thrown error that is neither InfraError nor GatewayClientError is a real
    // bug, not a transient miss — the wrapper must propagate it, not swallow it.
    mockServiceClient.loadPersonalityInternal.mockRejectedValue(new Error('unexpected boom'));
    await expect(loader.loadPersonality('lila', 'user-1')).rejects.toThrow('unexpected boom');
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

  it('keys an undefined userId distinctly from a user-scoped key (no cross-bleed)', async () => {
    // Internal/no-userId loads (the `\x00`-prefixed key, since the userId
    // portion is empty) must NOT collide with a real user's scoped result,
    // and vice versa — each is its own hop.
    mockServiceClient.loadPersonalityInternal
      .mockResolvedValueOnce(ok({ personality: PERSONALITY }))
      .mockResolvedValueOnce(ok({ personality: null }));

    expect(await loader.loadPersonality('lila')).not.toBeNull(); // no userId → key '\x00lila'
    expect(await loader.loadPersonality('lila', 'user-1')).toBeNull(); // key 'user-1\x00lila'
    // Each side stays cached independently — no third hop.
    expect(await loader.loadPersonality('lila')).not.toBeNull();
    expect(await loader.loadPersonality('lila', 'user-1')).toBeNull();

    expect(mockServiceClient.loadPersonalityInternal).toHaveBeenCalledTimes(2);
    expect(mockServiceClient.loadPersonalityInternal).toHaveBeenCalledWith({ nameOrId: 'lila' });
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
