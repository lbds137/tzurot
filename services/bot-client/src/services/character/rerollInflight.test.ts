import { describe, it, expect, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { GATEWAY_TIMEOUTS } from '@tzurot/common-types/constants/discord';
import {
  REROLL_BOOT_ID,
  REROLL_INFLIGHT_MIN_AGE_MS,
  REROLL_INFLIGHT_TTL_MS,
  appendInflightExtra,
  buildInflightRecord,
  claimInflight,
  deleteInflight,
  peekInflight,
  scanInflightJobIds,
  writeInflight,
  type RerollInflightRecord,
} from './rerollInflight.js';

/** A Redis whose MULTI runs its queued commands against one shared map, like the real one, plus SCAN. */
function statefulRedis(initial: Record<string, string> = {}, scanPageSize = 100) {
  const store = new Map(Object.entries(initial));
  const redis = {
    set: vi.fn(async (key: string, value: string, ..._flags: unknown[]) => {
      store.set(key, value);
      return 'OK';
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    keys: vi.fn(),
    scan: vi.fn(async (cursor: string, _match: string, pattern: string) => {
      const prefix = pattern.replaceAll('*', '');
      const all = [...store.keys()].filter(key => key.startsWith(prefix));
      const start = Number(cursor);
      const page = all.slice(start, start + scanPageSize);
      const next = start + scanPageSize >= all.length ? '0' : String(start + scanPageSize);
      return [next, page];
    }),
    multi: vi.fn(() => {
      const queued: Array<() => unknown> = [];
      const chain = {
        get: (key: string) => {
          queued.push(() => store.get(key) ?? null);
          return chain;
        },
        del: (key: string) => {
          queued.push(() => (store.delete(key) ? 1 : 0));
          return chain;
        },
        exec: async () => queued.map(run => [null, run()]),
      };
      return chain;
    }),
  };
  return { redis: redis as unknown as Redis, store, mocks: redis };
}

const record: RerollInflightRecord = {
  jobId: 'job-1',
  rowId: 'row-1',
  attemptId: 'attempt-1',
  bootId: 'boot-old',
  actorId: 'clicker',
  routeKey: '222',
  keepMemoryIds: ['old-mem'],
  channelId: 'chan-1',
  personalityId: 'pers-1',
  rowContent: 'OLD REPLY',
  chunks: [
    { id: '222', before: 'old chunk 1' },
    { id: '223', before: 'old chunk 2' },
  ],
  editedCount: 1,
  extraIds: [],
  newMemoryIds: ['new-mem'],
  newPendingIds: ['new-pend'],
  createdAt: Date.now(),
  writtenAt: Date.now(),
};

describe('record lifetime', () => {
  it('lives at least a day and this process has a boot id', () => {
    expect(REROLL_INFLIGHT_TTL_MS).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000);
    expect(REROLL_BOOT_ID.length).toBeGreaterThan(0);
  });

  it('is claimed only after the longest live-handler path: three gateway writes and two Discord phases', () => {
    expect(REROLL_INFLIGHT_MIN_AGE_MS).toBeGreaterThanOrEqual(3 * GATEWAY_TIMEOUTS.WRITE);
    expect(REROLL_INFLIGHT_MIN_AGE_MS).toBeLessThan(REROLL_INFLIGHT_TTL_MS);
  });
});

describe('buildInflightRecord', () => {
  const input = {
    jobId: 'job-1',
    rowId: 'row-1',
    attemptId: 'attempt-1',
    actorId: 'clicker',
    routeKey: '222',
    keepMemoryIds: ['old-mem'],
    newMemoryIds: ['new-mem'],
    newPendingIds: ['new-pend'],
    channelId: 'chan-1',
    personalityId: 'pers-1',
    rowContent: 'OLD REPLY',
    liveChunks: [
      { id: '222', content: 'old chunk 1' },
      { id: '223', content: 'old chunk 2' },
      { id: '224', content: 'old chunk 3' },
    ],
  };

  it('stamps this process, keeps every live chunk with its pre-edit text and starts with no extras', () => {
    const built = buildInflightRecord({ ...input, newChunkCount: 3 });

    expect(built.bootId).toBe(REROLL_BOOT_ID);
    expect(built.chunks).toEqual([
      { id: '222', before: 'old chunk 1' },
      { id: '223', before: 'old chunk 2' },
      { id: '224', before: 'old chunk 3' },
    ]);
    expect(built.extraIds).toEqual([]);
    // The attempt's reported ids ride along for recovery's abort fallback.
    expect(built.newMemoryIds).toEqual(['new-mem']);
    expect(built.newPendingIds).toEqual(['new-pend']);
    expect(built.createdAt).toBe(built.writtenAt);
    expect(built.createdAt).toBeGreaterThan(0);
    expect(built).not.toHaveProperty('liveChunks');
  });

  it.each([
    [1, 1],
    [3, 3],
    [5, 3],
  ])('a new reply of %i chunks overwrites %i of the 3 live ones', (newChunkCount, edited) => {
    expect(buildInflightRecord({ ...input, newChunkCount }).editedCount).toBe(edited);
  });
});

describe('writeInflight / appendInflightExtra / deleteInflight', () => {
  it('stores the record under reroll:inflight:<jobId> with the TTL, stamping writtenAt', async () => {
    const { redis, mocks, store } = statefulRedis();
    const fresh = { ...record, createdAt: Date.now(), writtenAt: 0 };

    await expect(writeInflight(redis, fresh)).resolves.toBe(true);

    expect(mocks.set).toHaveBeenCalledWith(
      'reroll:inflight:job-1',
      JSON.stringify(fresh),
      'PX',
      expect.any(Number)
    );
    const ttl = mocks.set.mock.calls[0][3] as number;
    expect(ttl).toBeLessThanOrEqual(REROLL_INFLIGHT_TTL_MS);
    expect(ttl).toBeGreaterThan(REROLL_INFLIGHT_TTL_MS - 5000);
    expect(fresh.writtenAt).toBeGreaterThan(0);
    expect(store.has('reroll:inflight:job-1')).toBe(true);
  });

  it('counts the TTL from createdAt, so a write-back never extends it', async () => {
    const { redis, mocks } = statefulRedis();
    const hourOld = { ...record, createdAt: Date.now() - 60 * 60 * 1000 };

    await writeInflight(redis, hourOld);

    const ttl = mocks.set.mock.calls[0][3] as number;
    expect(ttl).toBeLessThanOrEqual(REROLL_INFLIGHT_TTL_MS - 60 * 60 * 1000);
    expect(ttl).toBeGreaterThan(REROLL_INFLIGHT_TTL_MS - 61 * 60 * 1000);
  });

  it('writes nothing for a record past its original expiry', async () => {
    const { redis, mocks, store } = statefulRedis();

    await expect(
      writeInflight(redis, { ...record, createdAt: Date.now() - REROLL_INFLIGHT_TTL_MS - 1000 })
    ).resolves.toBe(false);

    expect(mocks.set).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it('peeks a record without claiming it, and answers null for none or for garbage', async () => {
    const { redis, store } = statefulRedis({
      'reroll:inflight:job-1': JSON.stringify(record),
      'reroll:inflight:bad': '{not json',
    });

    expect(await peekInflight(redis, 'job-1')).toEqual(record);
    expect(store.has('reroll:inflight:job-1')).toBe(true);
    expect(await peekInflight(redis, 'bad')).toBeNull();
    expect(await peekInflight(redis, 'none')).toBeNull();
  });

  it('rewrites the record with each extra id, in order, and mutates the caller copy', async () => {
    const { redis, store } = statefulRedis();
    const live = { ...record, extraIds: [] as string[] };

    await appendInflightExtra(redis, live, 'x1');
    await appendInflightExtra(redis, live, 'x2');

    expect(live.extraIds).toEqual(['x1', 'x2']);
    expect(JSON.parse(store.get('reroll:inflight:job-1') as string).extraIds).toEqual(['x1', 'x2']);
  });

  it('deletes the record', async () => {
    const { redis, store } = statefulRedis({ 'reroll:inflight:job-1': JSON.stringify(record) });

    await deleteInflight(redis, 'job-1');

    expect(store.size).toBe(0);
  });

  it('never throws when Redis is down', async () => {
    const down = {
      set: vi.fn().mockRejectedValue(new Error('down')),
      del: vi.fn().mockRejectedValue(new Error('down')),
    } as unknown as Redis;

    await expect(writeInflight(down, record)).resolves.toBe(false);
    await expect(appendInflightExtra(down, { ...record }, 'x')).resolves.toBeUndefined();
    await expect(deleteInflight(down, 'job-1')).resolves.toBeUndefined();
  });
});

describe('scanInflightJobIds', () => {
  it('walks every SCAN page and never calls KEYS; ignores other key families', async () => {
    const { redis, mocks } = statefulRedis(
      {
        'reroll:inflight:a': '1',
        'reroll:inflight:b': '1',
        'reroll:inflight:c': '1',
        'reroll:job:zzz': '1',
      },
      2
    );

    const ids = await scanInflightJobIds(redis);

    expect(ids.sort()).toEqual(['a', 'b', 'c']);
    expect(mocks.keys).not.toHaveBeenCalled();
    expect(mocks.scan).toHaveBeenCalledTimes(2);
    expect(mocks.scan).toHaveBeenCalledWith('0', 'MATCH', 'reroll:inflight:*', 'COUNT', 100);
  });

  it('returns what it has when Redis fails midway', async () => {
    const failing = { scan: vi.fn().mockRejectedValue(new Error('down')) } as unknown as Redis;

    await expect(scanInflightJobIds(failing)).resolves.toEqual([]);
  });
});

describe('claimInflight', () => {
  const key = 'reroll:inflight:job-1';

  it('claims and deletes a record the predicate accepts', async () => {
    const { redis, store } = statefulRedis({ [key]: JSON.stringify(record) });

    await expect(claimInflight(redis, 'job-1', r => r.bootId !== 'boot-new')).resolves.toEqual(
      record
    );
    expect(store.size).toBe(0);
  });

  it('leaves a record the predicate refuses where it is (this process boot id)', async () => {
    const own = { ...record, bootId: REROLL_BOOT_ID };
    const { redis, store } = statefulRedis({ [key]: JSON.stringify(own) });

    await expect(
      claimInflight(redis, 'job-1', r => r.bootId !== REROLL_BOOT_ID)
    ).resolves.toBeNull();
    expect(store.has(key)).toBe(true);
  });

  it('hands the record to exactly one of two concurrent claimers', async () => {
    const { redis } = statefulRedis({ [key]: JSON.stringify(record) });

    const claims = await Promise.all([
      claimInflight(redis, 'job-1', () => true),
      claimInflight(redis, 'job-1', () => true),
    ]);

    expect(claims.filter(claimed => claimed !== null)).toEqual([record]);
  });

  it('puts a record back when the claimed value is not acceptable after all (replaced between peek and claim)', async () => {
    const own = { ...record, bootId: REROLL_BOOT_ID };
    const { redis, store, mocks } = statefulRedis({ [key]: JSON.stringify(record) });
    // The peek sees a foreign record; before the claim lands, a live handler of
    // this process rewrites the key.
    mocks.get.mockImplementationOnce(async () => {
      store.set(key, JSON.stringify(own));
      return JSON.stringify(record);
    });

    const claimed = await claimInflight(redis, 'job-1', r => r.bootId !== REROLL_BOOT_ID);

    expect(claimed).toBeNull();
    expect(JSON.parse(store.get(key) as string).bootId).toBe(REROLL_BOOT_ID);
  });

  it('returns null for a missing, malformed or wrong-shaped record, and never throws', async () => {
    await expect(claimInflight(statefulRedis().redis, 'job-1', () => true)).resolves.toBeNull();
    await expect(
      claimInflight(statefulRedis({ [key]: '{not json' }).redis, 'job-1', () => true)
    ).resolves.toBeNull();
    await expect(
      claimInflight(statefulRedis({ [key]: '{"rowId":1}' }).redis, 'job-1', () => true)
    ).resolves.toBeNull();
    const down = {
      get: vi.fn().mockRejectedValue(new Error('down')),
      multi: vi.fn(() => {
        throw new Error('down');
      }),
    } as unknown as Redis;
    await expect(claimInflight(down, 'job-1', () => true)).resolves.toBeNull();
  });
});
