import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { constructed, instances } = vi.hoisted(() => ({
  constructed: [] as Record<string, unknown>[],
  instances: [] as { flushdb: () => Promise<string>; quit: () => Promise<string> }[],
}));

vi.mock('ioredis', () => ({
  Redis: class {
    connect = vi.fn().mockResolvedValue(undefined);
    flushdb = vi.fn().mockResolvedValue('OK');
    quit = vi.fn().mockResolvedValue('OK');
    on = vi.fn();
    constructor(options: Record<string, unknown>) {
      constructed.push(options);
      instances.push(this as never);
    }
  },
}));

import { setupTestEnvironment } from './setup-pglite.js';

describe('setupTestEnvironment lane wiring', () => {
  const originalLane = process.env.TZUROT_TEST_LANE;
  const originalRedisUrl = process.env.REDIS_URL;

  beforeEach(() => {
    constructed.length = 0;
    instances.length = 0;
    process.env.REDIS_URL = 'redis://127.0.0.1:6379';
  });

  afterEach(() => {
    if (originalLane === undefined) {
      delete process.env.TZUROT_TEST_LANE;
    } else {
      process.env.TZUROT_TEST_LANE = originalLane;
    }
    if (originalRedisUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = originalRedisUrl;
    }
  });

  it.each([
    ['b', 14],
    ['d', 12],
  ])('connects ioredis to Redis DB for lane %s (db %i)', async (lane, db) => {
    process.env.TZUROT_TEST_LANE = lane;
    const env = await setupTestEnvironment();
    // Setup flushes the lane DB once before any test runs.
    expect(instances[0].flushdb).toHaveBeenCalledTimes(1);
    await env.cleanup();

    expect(constructed).toHaveLength(1);
    expect(constructed[0]).toMatchObject({ db });
    expect(instances[0].quit).toHaveBeenCalled();
    // Cleanup flushes again, so the lane DB is left empty.
    expect(instances[0].flushdb).toHaveBeenCalledTimes(2);
  });

  it('derives the lane from the checkout path when TZUROT_TEST_LANE is unset (db 13)', async () => {
    delete process.env.TZUROT_TEST_LANE;
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/x/tzurot-c');
    try {
      const env = await setupTestEnvironment();
      await env.cleanup();
    } finally {
      cwdSpy.mockRestore();
    }

    expect(constructed).toHaveLength(1);
    expect(constructed[0]).toMatchObject({ db: 13 });
  });

  it('honours an explicit REDIS_URL database over the lane DB (db 5)', async () => {
    process.env.TZUROT_TEST_LANE = 'b';
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/5';
    const env = await setupTestEnvironment();
    await env.cleanup();

    expect(constructed).toHaveLength(1);
    expect(constructed[0]).toMatchObject({ db: 5 });
  });

  it("refuses another lane's Redis DB before constructing IORedis (db 15 in lane b)", async () => {
    process.env.TZUROT_TEST_LANE = 'b';
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/15';

    await expect(setupTestEnvironment()).rejects.toThrow(/belongs to test lane a/);
    expect(constructed).toHaveLength(0);
  });
});
