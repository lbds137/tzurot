import { describe, it, expect, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import { VoiceTranscriptCache } from './VoiceTranscriptCache.js';
import { REDIS_KEY_PREFIXES, INTERVALS } from '../constants/index.js';

/**
 * Minimal in-memory Redis stub honoring the two methods the cache uses.
 * TTL is captured but not enforced (the tests don't exercise expiry).
 */
function makeRedisStub(): {
  redis: Redis;
  store: Map<string, string>;
  lastSetexTtl: () => number | undefined;
} {
  const store = new Map<string, string>();
  let lastTtl: number | undefined;
  const redis = {
    async setex(key: string, ttl: number, value: string): Promise<'OK'> {
      lastTtl = ttl;
      store.set(key, value);
      return 'OK';
    },
    async get(key: string): Promise<string | null> {
      return store.get(key) ?? null;
    },
  } as unknown as Redis;
  return { redis, store, lastSetexTtl: () => lastTtl };
}

describe('VoiceTranscriptCache', () => {
  const base = 'https://cdn.discordapp.com/attachments/111/222/voice.ogg';
  let stub: ReturnType<typeof makeRedisStub>;
  let cache: VoiceTranscriptCache;

  beforeEach(() => {
    stub = makeRedisStub();
    cache = new VoiceTranscriptCache(stub.redis);
  });

  it('round-trips a transcript stored and read under the same URL', async () => {
    await cache.store(`${base}?ex=AAAA&is=BBBB&hs=CCCC`, 'hello world');
    const got = await cache.get(`${base}?ex=AAAA&is=BBBB&hs=CCCC`);
    expect(got).toBe('hello world');
  });

  it('HITS when stored and read under DIFFERENT signatures of the same attachment', async () => {
    // The core bug fix: Discord re-signs ex/is/hs on every re-fetch, so the
    // store-side URL and the lookup-side URL differ — but must resolve to one key.
    await cache.store(`${base}?ex=AAAA&is=BBBB&hs=CCCC`, 'transcribed text');
    const got = await cache.get(`${base}?ex=ZZZZ&is=YYYY&hs=XXXX`);
    expect(got).toBe('transcribed text');
  });

  it('stores under a query-stripped, hashed key (not the raw signed URL)', async () => {
    await cache.store(`${base}?ex=AAAA`, 'text');
    const keys = [...stub.store.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0].startsWith(`${REDIS_KEY_PREFIXES.VOICE_TRANSCRIPT}url:`)).toBe(true);
    expect(keys[0]).not.toContain('ex=AAAA');
    expect(keys[0]).not.toContain(base);
  });

  it('MISSES for a different attachment path', async () => {
    await cache.store(`${base}?ex=AAAA`, 'text');
    const got = await cache.get('https://cdn.discordapp.com/attachments/111/333/other.ogg?ex=AAAA');
    expect(got).toBeNull();
  });

  it('defaults the store TTL to VOICE_TRANSCRIPT_TTL', async () => {
    await cache.store(base, 'text');
    expect(stub.lastSetexTtl()).toBe(INTERVALS.VOICE_TRANSCRIPT_TTL);
  });

  it('honors an explicit ttlSeconds override', async () => {
    await cache.store(base, 'text', 120);
    expect(stub.lastSetexTtl()).toBe(120);
  });

  it('returns null (not the empty string) for an empty cached value', async () => {
    await cache.store(base, '');
    expect(await cache.get(base)).toBeNull();
  });
});
