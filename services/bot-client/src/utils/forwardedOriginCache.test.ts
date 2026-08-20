import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Message } from 'discord.js';

vi.mock('./forwardedMessageUtils.js', () => ({
  resolveForwardedOrigin: vi.fn(() => Promise.resolve(undefined)),
}));

const { resolveForwardedOrigin } = await import('./forwardedMessageUtils.js');
const {
  primeForwardedOrigins,
  getCachedForwardedOrigin,
  __resetForwardedOriginCacheForTests,
  MAX_FORWARD_ORIGIN_RESOLUTIONS_PER_FETCH,
} = await import('./forwardedOriginCache.js');

function forward(id: string): Message {
  return { id } as unknown as Message;
}

const origin = { authorName: 'COLD', authorId: 'a-1', timestamp: '2026-08-18T11:13:53.000Z' };

describe('forwardedOriginCache', () => {
  beforeEach(() => {
    __resetForwardedOriginCacheForTests();
    vi.mocked(resolveForwardedOrigin).mockReset();
    vi.mocked(resolveForwardedOrigin).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes a cap small enough to bound the REST cost of one fetch window', () => {
    expect(MAX_FORWARD_ORIGIN_RESOLUTIONS_PER_FETCH).toBe(10);
  });

  it('returns undefined for a message that was never primed, without resolving', () => {
    expect(getCachedForwardedOrigin('never-seen')).toBeUndefined();
    expect(resolveForwardedOrigin).not.toHaveBeenCalled();
  });

  it('caches a resolved origin and serves it from the cache', async () => {
    vi.mocked(resolveForwardedOrigin).mockResolvedValue(origin);

    await primeForwardedOrigins([forward('f1')]);

    expect(getCachedForwardedOrigin('f1')).toEqual(origin);
  });

  it('does not resolve a second time for an already-primed message', async () => {
    vi.mocked(resolveForwardedOrigin).mockResolvedValue(origin);

    await primeForwardedOrigins([forward('f1')]);
    await primeForwardedOrigins([forward('f1')]);

    // The whole point of the cache: the extended-context window is re-fetched
    // every turn, so a second prime of the same forward must cost no calls.
    expect(resolveForwardedOrigin).toHaveBeenCalledTimes(1);
  });

  it('negative-caches an unresolvable forward so it stops re-fetching', async () => {
    vi.mocked(resolveForwardedOrigin).mockResolvedValue(undefined);

    await primeForwardedOrigins([forward('f1')]);
    await primeForwardedOrigins([forward('f1')]);

    expect(resolveForwardedOrigin).toHaveBeenCalledTimes(1);
    expect(getCachedForwardedOrigin('f1')).toBeUndefined();
  });

  it('hands the resolver the message and the injected personality resolver', async () => {
    const resolver = vi.fn(() => Promise.resolve('personality-uuid'));
    const msg = forward('f1');

    await primeForwardedOrigins([msg], resolver);

    // Asserts what crosses the seam: a prime that dropped the injected resolver
    // would still cache an origin, just one with no `authorPersonalityId`.
    expect(resolveForwardedOrigin).toHaveBeenCalledWith(msg, resolver);
  });

  it('primes a batch in one pass', async () => {
    vi.mocked(resolveForwardedOrigin).mockImplementation((msg: Message) =>
      Promise.resolve({ authorName: `author-${msg.id}` })
    );

    await primeForwardedOrigins([forward('f1'), forward('f2'), forward('f3')]);

    expect(getCachedForwardedOrigin('f1')).toEqual({ authorName: 'author-f1' });
    expect(getCachedForwardedOrigin('f2')).toEqual({ authorName: 'author-f2' });
    expect(getCachedForwardedOrigin('f3')).toEqual({ authorName: 'author-f3' });
  });

  it('never rejects when one entry throws, and still primes the others', async () => {
    vi.mocked(resolveForwardedOrigin).mockImplementation((msg: Message) =>
      msg.id === 'bad' ? Promise.reject(new Error('boom')) : Promise.resolve(origin)
    );

    await expect(primeForwardedOrigins([forward('bad'), forward('good')])).resolves.toBeUndefined();

    expect(getCachedForwardedOrigin('bad')).toBeUndefined();
    expect(getCachedForwardedOrigin('good')).toEqual(origin);
  });

  it('negative-caches a thrown entry rather than retrying it every turn', async () => {
    vi.mocked(resolveForwardedOrigin).mockRejectedValue(new Error('boom'));

    await primeForwardedOrigins([forward('f1')]);
    await primeForwardedOrigins([forward('f1')]);

    expect(resolveForwardedOrigin).toHaveBeenCalledTimes(1);
  });

  it('starts cold again after a reset', async () => {
    vi.mocked(resolveForwardedOrigin).mockResolvedValue(origin);
    await primeForwardedOrigins([forward('f1')]);

    __resetForwardedOriginCacheForTests();

    expect(getCachedForwardedOrigin('f1')).toBeUndefined();
  });
});
