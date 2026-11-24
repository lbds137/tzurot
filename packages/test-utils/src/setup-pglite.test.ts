import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { constructed, instances } = vi.hoisted(() => ({
  constructed: [] as Record<string, unknown>[],
  instances: [] as { flushdb: () => Promise<number>; quit: () => Promise<string> }[],
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
    await env.cleanup();

    expect(constructed).toHaveLength(1);
    expect(constructed[0]).toMatchObject({ db });
    expect(instances[0].quit).toHaveBeenCalled();
  });
});
