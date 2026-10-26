import { describe, it, expect } from 'vitest';
import { createMockRedis } from './mockRedis.js';

describe('createMockRedis', () => {
  it('round-trips values through setex and get, returns null for missing keys, and resolves expire', async () => {
    const { redis, storage } = createMockRedis();

    expect(await redis.get('missing')).toBeNull();
    expect(await redis.setex('session:1', 60, 'payload-1')).toBe('OK');
    expect(storage.get('session:1')).toBe('payload-1');
    expect(await redis.get('session:1')).toBe('payload-1');
    expect(await redis.expire('session:1', 120)).toBe(1);
  });

  it('deletes existing keys and returns the count actually deleted', async () => {
    const { redis, storage } = createMockRedis();
    await redis.setex('k1', 60, 'v1');
    await redis.setex('k2', 60, 'v2');

    const deleted = await redis.del('k1', 'missing-key', 'k2');

    expect(deleted).toBe(2);
    expect(storage.has('k1')).toBe(false);
    expect(storage.has('k2')).toBe(false);
  });

  it('returns mget values in requested key order with null for missing keys', async () => {
    const { redis } = createMockRedis();
    await redis.setex('k1', 60, 'first');
    await redis.setex('k3', 60, 'third');

    expect(await redis.mget(['k3', 'k2', 'k1'])).toEqual(['third', null, 'first']);
  });

  describe('scan glob matching', () => {
    it('matches session:* against session:a without matching session-msg:a or unanchored prefixes', async () => {
      const { redis } = createMockRedis();
      await redis.setex('session:a', 60, '1');
      await redis.setex('session-msg:a', 60, '2');
      await redis.setex('other:session:a', 60, '3');

      const [cursor, keys] = await redis.scan('0', 'MATCH', 'session:*', 'COUNT', 100);

      expect(cursor).toBe('0');
      expect(keys).toEqual(['session:a']);
    });

    it('treats ? as a single-character wildcard and anchors both ends of the pattern', async () => {
      const { redis } = createMockRedis();
      await redis.setex('item:a', 60, '1');
      await redis.setex('item:ab', 60, '2');
      await redis.setex('item:', 60, '3');
      await redis.setex('prefix-item:a', 60, '4');

      const [cursor, keys] = await redis.scan('0', 'MATCH', 'item:?', 'COUNT', 100);

      expect(cursor).toBe('0');
      expect(keys).toEqual(['item:a']);
    });

    it('escapes regex metacharacters in the glob pattern so they match literally', async () => {
      const { redis } = createMockRedis();
      await redis.setex('a.b1', 60, '1');
      await redis.setex('axb1', 60, '2');

      const [cursor, keys] = await redis.scan('0', 'MATCH', 'a.b*', 'COUNT', 100);

      expect(cursor).toBe('0');
      expect(keys).toEqual(['a.b1']);
    });
  });

  it('applies pipeline setex, del, and expire to storage, records pipelineOps, and returns per-op exec tuples', async () => {
    const { redis, storage, pipelineOps } = createMockRedis();
    await redis.setex('stale', 60, 'old');

    const pipeline = redis.pipeline();
    pipeline.setex('fresh', 90, 'new-val').del('stale').expire('fresh', 120);
    const results = await pipeline.exec();

    expect(storage.get('fresh')).toBe('new-val');
    expect(storage.has('stale')).toBe(false);
    expect(results).toEqual([
      [null, 'OK'],
      [null, 1],
      [null, 1],
    ]);
    expect(pipelineOps).toEqual([
      { method: 'setex', args: ['fresh', 90, 'new-val'] },
      { method: 'del', args: ['stale'] },
      { method: 'expire', args: ['fresh', 120] },
    ]);

    // Starting a new pipeline resets pipelineOps for the new batch.
    redis.pipeline();
    expect(pipelineOps).toEqual([]);
  });

  it('applies nothing before exec: queued setex leaves get null until exec runs', async () => {
    const { redis } = createMockRedis();

    const pipeline = redis.pipeline();
    pipeline.setex('pending', 60, 'queued-val');

    expect(await redis.get('pending')).toBeNull();

    await pipeline.exec();

    expect(await redis.get('pending')).toBe('queued-val');
  });

  it('returns del count reflecting key existence at apply time', async () => {
    const { redis } = createMockRedis();

    const results = await redis.pipeline().del('missing-key').exec();

    expect(results).toEqual([[null, 0]]);
  });

  it('returns 1 from expire when the key exists in storage and 0 when it is missing', async () => {
    const { redis } = createMockRedis();
    await redis.setex('existing-key', 60, 'value');

    expect(await redis.expire('existing-key', 120)).toBe(1);
    expect(await redis.expire('missing-key', 120)).toBe(0);
  });

  it('returns pipeline expire status reflecting key existence at apply time', async () => {
    const { redis } = createMockRedis();
    await redis.setex('existing-key', 60, 'value');

    const results = await redis
      .pipeline()
      .expire('existing-key', 120)
      .expire('missing-key', 120)
      .exec();

    expect(results).toEqual([
      [null, 1],
      [null, 0],
    ]);
  });
});
