import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RunLease, RUN_LEASE_KEY, RUN_LEASE_TTL_MS, RunLeaseUnavailableError } from './runLease.js';
import type { RunLeaseRedis } from './runLease.js';

type RedisMethod = 'set' | 'get' | 'pexpire' | 'del';

/**
 * Minimal in-memory double for the three Redis commands `RunLease` uses,
 * honoring the semantics its logic depends on: `NX` refuses to overwrite a
 * live key, `PX` sets an expiry Date.now() controls (so fake timers drive
 * expiry), and an expired entry reads back as absent everywhere.
 */
class FakeRunLeaseRedis {
  private store = new Map<string, { value: string; expiresAt: number }>();
  private pendingRejections: Partial<Record<RedisMethod, Error>> = {};

  /** Make the NEXT call to this specific method reject with `error`. */
  rejectNextCall(method: RedisMethod, error: Error): void {
    this.pendingRejections[method] = error;
  }

  private consumeRejection(method: RedisMethod): void {
    const err = this.pendingRejections[method];
    if (err !== undefined) {
      delete this.pendingRejections[method];
      throw err;
    }
  }

  private isLive(key: string): boolean {
    const entry = this.store.get(key);
    if (entry === undefined) {
      return false;
    }
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  async set(key: string, value: string, ...args: unknown[]): Promise<string | null> {
    this.consumeRejection('set');
    const nx = args.includes('NX');
    if (nx && this.isLive(key)) {
      return null;
    }
    const pxIndex = args.indexOf('PX');
    const px = pxIndex >= 0 ? Number(args[pxIndex + 1]) : undefined;
    this.store.set(key, { value, expiresAt: px !== undefined ? Date.now() + px : Infinity });
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    this.consumeRejection('get');
    return this.isLive(key) ? (this.store.get(key)?.value ?? null) : null;
  }

  async pexpire(key: string, ms: number): Promise<number> {
    this.consumeRejection('pexpire');
    if (!this.isLive(key)) {
      return 0;
    }
    const entry = this.store.get(key);
    if (entry !== undefined) {
      entry.expiresAt = Date.now() + ms;
    }
    return 1;
  }

  async del(key: string): Promise<number> {
    this.consumeRejection('del');
    const had = this.isLive(key);
    this.store.delete(key);
    return had ? 1 : 0;
  }
}

function makeRedis(): FakeRunLeaseRedis {
  return new FakeRunLeaseRedis();
}

function makeLease(redis: FakeRunLeaseRedis, now?: () => Date): RunLease {
  return new RunLease(redis as unknown as RunLeaseRedis, now ?? (() => new Date()));
}

async function acquireOrThrow(lease: RunLease, runContext: string): Promise<string> {
  const result = await lease.acquire(runContext);
  if (!result.acquired) {
    throw new Error('expected acquire to succeed in test setup');
  }
  return result.runId;
}

describe('RunLease', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('acquire', () => {
    it('succeeds on an empty store, storing the runId/runContext/acquiredAt', async () => {
      const redis = makeRedis();
      const fixedNow = new Date('2026-01-01T00:00:00.000Z');
      const lease = makeLease(redis, () => fixedNow);

      const result = await lease.acquire('test-run');

      expect(result.acquired).toBe(true);
      if (!result.acquired) throw new Error('unreachable');
      expect(result.runId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );

      const stored = JSON.parse((await redis.get(RUN_LEASE_KEY)) ?? 'null') as Record<
        string,
        unknown
      >;
      expect(stored).toEqual({
        runId: result.runId,
        runContext: 'test-run',
        acquiredAt: fixedNow.toISOString(),
      });
    });

    it('the lease is still held at TTL-1ms and gone at TTL', async () => {
      const redis = makeRedis();
      const lease = makeLease(redis);
      await acquireOrThrow(lease, 'ctx');

      await vi.advanceTimersByTimeAsync(RUN_LEASE_TTL_MS - 1);
      expect(await redis.get(RUN_LEASE_KEY)).not.toBeNull();

      await vi.advanceTimersByTimeAsync(1);
      expect(await redis.get(RUN_LEASE_KEY)).toBeNull();
    });

    it('a second acquire while held is refused, naming the FIRST run as holder (the NX canary)', async () => {
      const redis = makeRedis();
      const lease = makeLease(redis);
      await acquireOrThrow(lease, 'first-run');

      const second = await lease.acquire('second-run');

      // If NX were dropped, this SET would silently overwrite the first
      // lease and this assertion would see 'second-run' instead.
      expect(second.acquired).toBe(false);
      if (second.acquired) throw new Error('unreachable');
      expect(second.holder?.runContext).toBe('first-run');
    });

    it('treats an unreadable stored value as someone else’s lease (fail closed)', async () => {
      const redis = makeRedis();
      const lease = makeLease(redis);
      await redis.set(RUN_LEASE_KEY, 'not json');

      expect(await lease.acquire('ctx')).toEqual({ acquired: false, holder: null });
    });

    it('treats a stored value missing required fields as unreadable too', async () => {
      const redis = makeRedis();
      const lease = makeLease(redis);
      await redis.set(RUN_LEASE_KEY, JSON.stringify({ runId: 'only-runid' }));

      expect(await lease.acquire('ctx')).toEqual({ acquired: false, holder: null });
    });

    it('treats a stored JSON value that parses to a non-object (e.g. null) as unreadable too', async () => {
      // JSON.parse('null') is `null`, not an object — a distinct failure shape
      // from "object missing fields" above: it must be caught by the object
      // guard itself, before the field destructure ever runs.
      const redis = makeRedis();
      const lease = makeLease(redis);
      await redis.set(RUN_LEASE_KEY, JSON.stringify(null));

      expect(await lease.acquire('ctx')).toEqual({ acquired: false, holder: null });
    });

    it('wraps a set() rejection in RunLeaseUnavailableError with cause preserved, never reporting acquired', async () => {
      const redis = makeRedis();
      const lease = makeLease(redis);
      const cause = new Error('ECONNREFUSED');
      redis.rejectNextCall('set', cause);

      const promise = lease.acquire('ctx');
      await expect(promise).rejects.toBeInstanceOf(RunLeaseUnavailableError);
      await expect(promise).rejects.toMatchObject({ cause });
    });
  });

  describe('refresh', () => {
    it('extends the TTL for its own runId', async () => {
      const redis = makeRedis();
      const lease = makeLease(redis);
      const runId = await acquireOrThrow(lease, 'ctx');

      await vi.advanceTimersByTimeAsync(9 * 60 * 1000);
      expect(await lease.refresh(runId, 'ctx')).toEqual({ ok: true });

      await vi.advanceTimersByTimeAsync(9 * 60 * 1000);
      expect(await redis.get(RUN_LEASE_KEY)).not.toBeNull();
      // A held, refreshed lease still refuses a new acquire.
      expect((await lease.acquire('other')).acquired).toBe(false);
    });

    it('refuses a foreign runId while held, and leaves the held value unchanged', async () => {
      const redis = makeRedis();
      const lease = makeLease(redis);
      await acquireOrThrow(lease, 'holder-ctx');
      const before = await redis.get(RUN_LEASE_KEY);

      const result = await lease.refresh('foreign-run-id', 'foreign-ctx');

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.holder?.runContext).toBe('holder-ctx');
      expect(await redis.get(RUN_LEASE_KEY)).toBe(before);
    });

    it('re-establishes an expired lease under the SAME runId when nobody else took it', async () => {
      const redis = makeRedis();
      const lease = makeLease(redis);
      const runId = await acquireOrThrow(lease, 'ctx');

      await vi.advanceTimersByTimeAsync(RUN_LEASE_TTL_MS);
      expect(await redis.get(RUN_LEASE_KEY)).toBeNull();

      expect(await lease.refresh(runId, 'ctx')).toEqual({ ok: true });

      const stored = JSON.parse((await redis.get(RUN_LEASE_KEY)) ?? 'null') as { runId: string };
      expect(stored.runId).toBe(runId);
      expect((await lease.acquire('other')).acquired).toBe(false);
      expect(await lease.release(runId)).toBe(true);
    });

    it('A expires, B acquires, refresh(A) reports B as the conflicting holder', async () => {
      const redis = makeRedis();
      const lease = makeLease(redis);
      const runIdA = await acquireOrThrow(lease, 'run-a');

      await vi.advanceTimersByTimeAsync(RUN_LEASE_TTL_MS);
      await acquireOrThrow(lease, 'run-b');

      const result = await lease.refresh(runIdA, 'run-a');
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.holder?.runContext).toBe('run-b');
    });

    it('falls through to SET NX when GET saw our lease but PEXPIRE reports it already gone', async () => {
      const redis = makeRedis();
      const lease = makeLease(redis);
      const runId = await acquireOrThrow(lease, 'ctx');

      // Simulate the real Redis race the comment in runLease.ts documents: the
      // key expires in the gap between GET and PEXPIRE. Deleting the key as a
      // side effect of the stubbed PEXPIRE keeps the double internally
      // consistent with what it reports, so the subsequent SET NX genuinely
      // succeeds rather than colliding with a still-live key.
      vi.spyOn(redis, 'pexpire').mockImplementationOnce(async () => {
        await redis.del(RUN_LEASE_KEY);
        return 0;
      });

      expect(await lease.refresh(runId, 'ctx')).toEqual({ ok: true });
    });

    it('treats an unreadable stored value as refused with a null holder', async () => {
      const redis = makeRedis();
      const lease = makeLease(redis);
      await redis.set(RUN_LEASE_KEY, 'not json');

      expect(await lease.refresh('any-run-id', 'ctx')).toEqual({ ok: false, holder: null });
    });

    it('reports the conflicting holder when the fall-through SET NX itself loses a race to re-establish an absent lease', async () => {
      // Distinct from the two races above: this one starts from a genuinely
      // ABSENT lease (nobody held it), so refresh() falls straight through to
      // setIfAbsent without ever entering the "held" or "foreign holder"
      // branches — and THAT SET NX loses to a second run's acquire landing in
      // the gap between our GET and our SET.
      const redis = makeRedis();
      const lease = makeLease(redis);
      const realSet = redis.set.bind(redis);

      vi.spyOn(redis, 'set').mockImplementationOnce(async () => {
        // Simulate a second run's acquire winning the race right here.
        await realSet(
          RUN_LEASE_KEY,
          JSON.stringify({
            runId: 'racer-run-id',
            runContext: 'racer-ctx',
            acquiredAt: new Date().toISOString(),
          }),
          'PX',
          RUN_LEASE_TTL_MS,
          'NX'
        );
        return null;
      });

      const result = await lease.refresh('our-run-id', 'our-ctx');

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.holder?.runContext).toBe('racer-ctx');
    });

    it('wraps a get() rejection in RunLeaseUnavailableError with cause preserved', async () => {
      const redis = makeRedis();
      const lease = makeLease(redis);
      const cause = new Error('ETIMEDOUT');
      redis.rejectNextCall('get', cause);

      const promise = lease.refresh('some-run-id', 'ctx');
      await expect(promise).rejects.toBeInstanceOf(RunLeaseUnavailableError);
      await expect(promise).rejects.toMatchObject({ cause });
    });

    it('wraps a pexpire() rejection in RunLeaseUnavailableError with cause preserved', async () => {
      const redis = makeRedis();
      const lease = makeLease(redis);
      const runId = await acquireOrThrow(lease, 'ctx');
      const cause = new Error('ETIMEDOUT');
      redis.rejectNextCall('pexpire', cause);

      const promise = lease.refresh(runId, 'ctx');
      await expect(promise).rejects.toBeInstanceOf(RunLeaseUnavailableError);
      await expect(promise).rejects.toMatchObject({ cause });
    });
  });

  describe('release', () => {
    it('release(own) removes the key; release(foreign) leaves it intact; release when absent is false', async () => {
      const redis = makeRedis();
      const lease = makeLease(redis);
      const runId = await acquireOrThrow(lease, 'ctx');

      expect(await lease.release('someone-else')).toBe(false);
      expect(await redis.get(RUN_LEASE_KEY)).not.toBeNull();

      expect(await lease.release(runId)).toBe(true);
      expect(await redis.get(RUN_LEASE_KEY)).toBeNull();

      expect(await lease.release(runId)).toBe(false);
    });

    it('release on an unreadable stored value is false and does NOT delete it', async () => {
      const redis = makeRedis();
      const lease = makeLease(redis);
      await redis.set(RUN_LEASE_KEY, 'not json');

      expect(await lease.release('any-run-id')).toBe(false);
      expect(await redis.get(RUN_LEASE_KEY)).toBe('not json');
    });

    it('wraps a del() rejection in RunLeaseUnavailableError with cause preserved', async () => {
      const redis = makeRedis();
      const lease = makeLease(redis);
      const runId = await acquireOrThrow(lease, 'ctx');
      const cause = new Error('ECONNRESET');
      redis.rejectNextCall('del', cause);

      const promise = lease.release(runId);
      await expect(promise).rejects.toBeInstanceOf(RunLeaseUnavailableError);
      await expect(promise).rejects.toMatchObject({ cause });
    });
  });
});
