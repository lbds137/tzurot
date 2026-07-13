/**
 * Tests for the shapes.inc global fetch-concurrency gate.
 *
 * The load-bearing properties: fail-OPEN on Redis errors (etiquette must
 * never break a user's export) WITHOUT holding a slot (so no unpaired
 * release), deny-without-holding at the cap, and a relatively-corrected
 * zero floor that composes with concurrent acquires.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { ShapesFetchGate, MAX_CONCURRENT_SHAPES_FETCHES } from './shapesFetchGate.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

interface MockRedis {
  redis: Redis;
  incr: ReturnType<typeof vi.fn>;
  decr: ReturnType<typeof vi.fn>;
  expire: ReturnType<typeof vi.fn>;
  incrby: ReturnType<typeof vi.fn>;
}

function createMockRedis(
  overrides: Partial<Record<'incr' | 'decr' | 'expire', () => Promise<number>>> = {}
): MockRedis {
  const incr = vi.fn(overrides.incr ?? (() => Promise.resolve(1)));
  const decr = vi.fn(overrides.decr ?? (() => Promise.resolve(0)));
  const expire = vi.fn(overrides.expire ?? (() => Promise.resolve(1)));
  const incrby = vi.fn().mockResolvedValue(0);
  return { redis: { incr, decr, expire, incrby } as unknown as Redis, incr, decr, expire, incrby };
}

describe('ShapesFetchGate', () => {
  describe('tryAcquire', () => {
    it('acquires a slot under the cap and refreshes the leak-bound TTL', async () => {
      const { redis, incr, decr, expire } = createMockRedis({ incr: () => Promise.resolve(1) });
      const gate = new ShapesFetchGate(redis);

      await expect(gate.tryAcquire()).resolves.toBe('acquired');
      expect(incr).toHaveBeenCalledTimes(1);
      expect(expire).toHaveBeenCalledTimes(1);
      expect(decr).not.toHaveBeenCalled();
    });

    it('allows exactly the cap (inclusive)', async () => {
      const { redis, decr } = createMockRedis({
        incr: () => Promise.resolve(MAX_CONCURRENT_SHAPES_FETCHES),
      });
      const gate = new ShapesFetchGate(redis);

      await expect(gate.tryAcquire()).resolves.toBe('acquired');
      expect(decr).not.toHaveBeenCalled();
    });

    it('denies over the cap and gives the provisional slot back (holds nothing)', async () => {
      const { redis, decr } = createMockRedis({
        incr: () => Promise.resolve(MAX_CONCURRENT_SHAPES_FETCHES + 1),
      });
      const gate = new ShapesFetchGate(redis);

      await expect(gate.tryAcquire()).resolves.toBe('denied');
      expect(decr).toHaveBeenCalledTimes(1);
    });

    it('respects a custom cap', async () => {
      const { redis } = createMockRedis({ incr: () => Promise.resolve(4) });
      expect(await new ShapesFetchGate(redis, 5).tryAcquire()).toBe('acquired');
      expect(await new ShapesFetchGate(redis, 3).tryAcquire()).toBe('denied');
    });

    it('fails OPEN when the increment itself fails — allowed, but NO slot held', async () => {
      // 'fail-open', not 'acquired': nothing was counted, so the caller must
      // not release — a release here would steal a legitimately-held slot.
      const { redis } = createMockRedis({ incr: () => Promise.reject(new Error('ECONNRESET')) });
      const gate = new ShapesFetchGate(redis);

      await expect(gate.tryAcquire()).resolves.toBe('fail-open');
    });

    it('still reports acquired when only the TTL refresh fails (the increment landed)', async () => {
      // The slot IS counted once incr succeeds — reporting fail-open here
      // would leak it until TTL. TTL refresh failure is non-fatal.
      const { redis } = createMockRedis({
        incr: () => Promise.resolve(1),
        expire: () => Promise.reject(new Error('ECONNRESET')),
      });
      const gate = new ShapesFetchGate(redis);

      await expect(gate.tryAcquire()).resolves.toBe('acquired');
    });
  });

  describe('release', () => {
    it('decrements the active counter', async () => {
      const { redis, decr, incrby } = createMockRedis({ decr: () => Promise.resolve(1) });
      const gate = new ShapesFetchGate(redis);

      await gate.release();
      expect(decr).toHaveBeenCalledTimes(1);
      expect(incrby).not.toHaveBeenCalled();
    });

    it('walks a negative counter back to zero RELATIVELY (composes with concurrent acquires)', async () => {
      // An absolute SET here would clobber a concurrent tryAcquire's
      // increment landing between the decr and the correction; incrby(-count)
      // adds back exactly the overshoot instead.
      const { redis, incrby } = createMockRedis({ decr: () => Promise.resolve(-2) });
      const gate = new ShapesFetchGate(redis);

      await gate.release();
      expect(incrby).toHaveBeenCalledWith(expect.stringContaining('active'), 2);
    });

    it('never throws on a Redis error (slot recovers via TTL)', async () => {
      const { redis } = createMockRedis({ decr: () => Promise.reject(new Error('ECONNRESET')) });
      const gate = new ShapesFetchGate(redis);

      await expect(gate.release()).resolves.toBeUndefined();
    });
  });
});
