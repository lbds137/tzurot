import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Client } from 'discord.js';
import { DiscordAPIError, RESTJSONErrorCodes } from 'discord.js';
import type { Redis } from 'ioredis';
import {
  RECOVERY_RETRY_DELAYS_MS,
  REROLL_RECOVERY_RESCAN_MS,
  handOffToRecovery,
  runRerollRecovery,
  startRerollRecoveryRescan,
  type RerollRecoveryDeps,
} from './rerollRecovery.js';
import { sha256Hex } from '@tzurot/common-types/utils/sha256Hex';
import {
  REROLL_INFLIGHT_MIN_AGE_MS,
  REROLL_INFLIGHT_TTL_MS,
  type RerollInflightRecord,
} from './rerollInflight.js';

const mocks = vi.hoisted(() => ({
  abort: vi.fn(),
  check: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../redis.js', () => ({
  redis: {},
  redisService: { storeWebhookMessage: vi.fn() },
}));
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsForUser: () => ({
    userClient: {
      abortRerollAssistantMessage: mocks.abort,
      checkRerollAssistantMessage: mocks.check,
    },
  }),
}));
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: mocks.warn,
      error: mocks.error,
    }),
  };
});

/** Redis with MULTI over one shared map (no interleaving, like the real one) and SCAN. */
function statefulRedis(): { redis: Redis; store: Map<string, string> } {
  const store = new Map<string, string>();
  const redis = {
    set: vi.fn(async (key: string, value: string, ...flags: unknown[]) => {
      if (flags.includes('NX') && store.has(key)) {
        return null;
      }
      store.set(key, value);
      return 'OK';
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    scan: vi.fn(async (_cursor: string, _match: string, pattern: string) => [
      '0',
      [...store.keys()].filter(key => key.startsWith(pattern.replace('*', ''))),
    ]),
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
  return { redis: redis as unknown as Redis, store };
}

function apiError(code: number): DiscordAPIError {
  return new DiscordAPIError({ code, message: 'x' }, code, 404, 'GET', 'url', {});
}

/** A DM message (bot-authored, not a webhook), so the real `resolveTarget` yields the dm target. */
function dmMessage(id: string, content: string) {
  return {
    id,
    content,
    webhookId: null,
    attachments: { size: 0 },
    edit: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

const record: RerollInflightRecord = {
  jobId: 'job-1',
  rowId: 'row-1',
  attemptId: 'attempt-1',
  bootId: 'boot-old',
  actorId: 'clicker',
  routeKey: 'a',
  keepMemoryIds: ['old-mem'],
  channelId: 'chan-1',
  personalityId: 'pers-1',
  rowContent: 'OLD REPLY',
  chunks: [
    { id: 'a', before: 'old a' },
    { id: 'b', before: 'old b' },
  ],
  editedCount: 1,
  extraIds: ['x1'],
  newMemoryIds: ['new-mem'],
  newPendingIds: ['new-pend'],
  // Written long enough ago that a live handler of a dead process cannot still be running.
  createdAt: Date.now() - 10 * 60 * 1000,
  writtenAt: Date.now() - 10 * 60 * 1000,
};
const KEY = 'reroll:inflight:job-1';
const GUARD_KEY = 'reroll:lock:row-1';

describe('runRerollRecovery', () => {
  let redis: Redis;
  let store: Map<string, string>;
  let discord: Record<string, ReturnType<typeof dmMessage>>;
  let fetchMessage: ReturnType<typeof vi.fn>;
  let channelsFetch: ReturnType<typeof vi.fn>;
  let schedule: ReturnType<typeof vi.fn>;
  let deps: RerollRecoveryDeps;

  /** The abort's answer: the old row is live with the record's own content unless `over` says otherwise. */
  const abortAnswer = (committed: boolean, over: Record<string, unknown> = {}) => ({
    ok: true,
    data: {
      removedMemories: 0,
      committed,
      oldRowLive: !committed,
      oldRowContentDigest: committed ? null : sha256Hex('OLD REPLY'),
      ...over,
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    ({ redis, store } = statefulRedis());
    store.set(KEY, JSON.stringify(record));
    discord = {
      a: dmMessage('a', 'NEW a'),
      b: dmMessage('b', 'old b'),
      x1: dmMessage('x1', 'NEW x1'),
    };
    fetchMessage = vi.fn(async (id: string) => {
      const found = discord[id];
      if (found === undefined) {
        throw apiError(RESTJSONErrorCodes.UnknownMessage);
      }
      return found;
    });
    channelsFetch = vi.fn().mockResolvedValue({
      isTextBased: () => true,
      isDMBased: () => true,
      send: vi.fn(),
      messages: { fetch: fetchMessage },
    });
    schedule = vi.fn();
    deps = {
      client: {
        users: { fetch: vi.fn().mockResolvedValue({ id: 'clicker' }) },
        channels: { fetch: channelsFetch },
      } as unknown as Client,
      redis,
      schedule: schedule as unknown as RerollRecoveryDeps['schedule'],
      bootId: 'boot-new',
    };
    mocks.abort.mockResolvedValue(abortAnswer(false));
  });

  it('a record left after begin, abort says aborted: the originals are edited back and the recorded extras deleted', async () => {
    const stats = await runRerollRecovery(deps);

    expect(mocks.abort).toHaveBeenCalledWith('a', {
      rowId: 'row-1',
      attemptId: 'attempt-1',
      jobId: 'job-1',
      // The attempt's reported ids ride along as the abort's fallback.
      newMemoryIds: ['new-mem'],
      newPendingIds: ['new-pend'],
      keepMemoryIds: ['old-mem'],
    });
    // The abort's own answer says whether the old row can be restored; no check call.
    expect(mocks.check).not.toHaveBeenCalled();
    expect(discord.a.edit).toHaveBeenCalledWith(expect.objectContaining({ content: 'old a' }));
    expect(discord.x1.delete).toHaveBeenCalledTimes(1);
    expect(discord.b.edit).not.toHaveBeenCalled();
    expect(discord.b.delete).not.toHaveBeenCalled();
    expect(store.has(KEY)).toBe(false);
    expect(stats).toEqual(expect.objectContaining({ claimed: 1, settled: 1 }));
  });

  it('a record left after a landed commit, abort says committed: finish runs and nothing is put back', async () => {
    mocks.abort.mockResolvedValue(abortAnswer(true));

    await runRerollRecovery(deps);

    expect(discord.b.delete).toHaveBeenCalledTimes(1);
    expect(discord.a.edit).not.toHaveBeenCalled();
    expect(discord.x1.delete).not.toHaveBeenCalled();
    expect(mocks.check).not.toHaveBeenCalled();
    expect(store.has(KEY)).toBe(false);
  });

  it.each([
    [
      'the content changed (an Edit Response)',
      abortAnswer(false, { oldRowContentDigest: sha256Hex('EDITED') }),
    ],
    [
      'a later reroll or edit replaced the row',
      abortAnswer(false, { oldRowLive: false, oldRowContentDigest: null }),
    ],
  ])(
    'aborted but %s: the originals are left alone, the extras (which no row owns) deleted, the record dropped with a warning naming ids only',
    async (_name, answer) => {
      mocks.abort.mockResolvedValue(answer);

      const stats = await runRerollRecovery(deps);

      expect(discord.a.edit).not.toHaveBeenCalled();
      expect(discord.b.edit).not.toHaveBeenCalled();
      expect(discord.b.delete).not.toHaveBeenCalled();
      expect(discord.x1.delete).toHaveBeenCalledTimes(1);
      expect(store.has(KEY)).toBe(false);
      expect(mocks.warn).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: 'job-1', rowId: 'row-1' }),
        expect.any(String)
      );
      expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain('old a');
      expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain('OLD REPLY');
      expect(stats).toEqual(expect.objectContaining({ dropped: 1 }));
    }
  );

  it('a record carrying this process boot id is not claimed', async () => {
    store.set(KEY, JSON.stringify({ ...record, bootId: 'boot-new' }));

    const stats = await runRerollRecovery(deps);

    expect(mocks.abort).not.toHaveBeenCalled();
    expect(store.has(KEY)).toBe(true);
    expect(stats).toEqual(expect.objectContaining({ scanned: 1, claimed: 0 }));
  });

  it('two passes over one record: exactly one acts', async () => {
    await Promise.all([runRerollRecovery(deps), runRerollRecovery(deps)]);

    expect(mocks.abort).toHaveBeenCalledTimes(1);
    expect(discord.a.edit).toHaveBeenCalledTimes(1);
  });

  it('skips chunks that are already gone: nothing fails and the record is settled', async () => {
    delete discord.x1;
    delete discord.b;

    const stats = await runRerollRecovery(deps);

    expect(discord.a.edit).toHaveBeenCalledWith(expect.objectContaining({ content: 'old a' }));
    expect(store.has(KEY)).toBe(false);
    expect(stats).toEqual(expect.objectContaining({ settled: 1 }));
  });

  it('settles quietly when every chunk is gone', async () => {
    discord = {};

    await runRerollRecovery(deps);

    expect(store.has(KEY)).toBe(false);
  });

  describe('an abort that cannot say what happened (unknown)', () => {
    beforeEach(() => {
      mocks.abort.mockResolvedValue({ ok: false, status: 503, error: 'x', kind: 'http' });
    });

    it('keeps the record (written back under this process) and retries in-process on the first backoff', async () => {
      const stats = await runRerollRecovery(deps);

      expect(JSON.parse(store.get(KEY) as string).bootId).toBe('boot-new');
      expect(schedule).toHaveBeenCalledTimes(1);
      expect(schedule).toHaveBeenCalledWith(expect.any(Function), RECOVERY_RETRY_DELAYS_MS[0]);
      expect(discord.a.edit).not.toHaveBeenCalled();
      expect(stats).toEqual(expect.objectContaining({ retrying: 1 }));
    });

    it('the retry claims its own write-back and settles once the gateway answers', async () => {
      await runRerollRecovery(deps);
      mocks.abort.mockResolvedValue(abortAnswer(false));

      await (schedule.mock.calls[0][0] as () => Promise<void>)();

      expect(discord.a.edit).toHaveBeenCalledWith(expect.objectContaining({ content: 'old a' }));
      expect(store.has(KEY)).toBe(false);
      expect(schedule).toHaveBeenCalledTimes(1);
    });

    it('after the last try logs at error and leaves the record to its TTL', async () => {
      await runRerollRecovery(deps);
      for (let i = 0; i < RECOVERY_RETRY_DELAYS_MS.length; i++) {
        await (schedule.mock.calls[i][0] as () => Promise<void>)();
      }

      expect(schedule).toHaveBeenCalledTimes(RECOVERY_RETRY_DELAYS_MS.length);
      expect(schedule.mock.calls.map(call => call[1])).toEqual([...RECOVERY_RETRY_DELAYS_MS]);
      expect(mocks.error).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: 'job-1', rowId: 'row-1' }),
        expect.any(String)
      );
      expect(store.has(KEY)).toBe(true);
      expect(mocks.abort).toHaveBeenCalledTimes(RECOVERY_RETRY_DELAYS_MS.length + 1);
    });
  });

  it('a restore that fails (not a gone message) is retried like an unknown abort and keeps the record', async () => {
    discord.a.edit.mockRejectedValue(apiError(RESTJSONErrorCodes.MissingPermissions));

    const stats = await runRerollRecovery(deps);

    expect(store.has(KEY)).toBe(true);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(stats).toEqual(expect.objectContaining({ retrying: 1 }));
  });

  describe('the per-row guard', () => {
    it('held by another attempt: no gateway or Discord call, the record is written back and retried', async () => {
      store.set(GUARD_KEY, 'attempt-2');

      const stats = await runRerollRecovery(deps);

      expect(mocks.abort).not.toHaveBeenCalled();
      expect(channelsFetch).not.toHaveBeenCalled();
      expect(JSON.parse(store.get(KEY) as string).bootId).toBe('boot-new');
      expect(schedule).toHaveBeenCalledWith(expect.any(Function), RECOVERY_RETRY_DELAYS_MS[0]);
      expect(store.get(GUARD_KEY)).toBe('attempt-2');
      expect(stats).toEqual(expect.objectContaining({ retrying: 1 }));
    });

    it('held by the dead attempt itself: recovery proceeds and releases it once the record settles', async () => {
      store.set(GUARD_KEY, 'attempt-1');

      await runRerollRecovery(deps);

      expect(discord.a.edit).toHaveBeenCalledWith(expect.objectContaining({ content: 'old a' }));
      expect(store.has(GUARD_KEY)).toBe(false);
    });

    it('free: recovery takes it for the dead attempt and releases it once settled', async () => {
      const takenDuring: Array<string | undefined> = [];
      discord.a.edit.mockImplementation(async () => {
        takenDuring.push(store.get(GUARD_KEY));
      });

      await runRerollRecovery(deps);

      expect(takenDuring).toEqual(['attempt-1']);
      expect(store.has(GUARD_KEY)).toBe(false);
    });

    it('an unknown abort releases the guard recovery took, so the row is rerollable between retries', async () => {
      mocks.abort.mockResolvedValue({ ok: false, status: 503, error: 'x', kind: 'http' });

      await runRerollRecovery(deps);

      expect(store.has(KEY)).toBe(true);
      expect(store.has(GUARD_KEY)).toBe(false);
    });

    it('a failed restore releases the guard recovery took', async () => {
      discord.a.edit.mockRejectedValue(apiError(RESTJSONErrorCodes.MissingPermissions));

      await runRerollRecovery(deps);

      expect(store.has(GUARD_KEY)).toBe(false);
    });

    it('a guard the dead attempt left in place (not taken here) survives a retry', async () => {
      store.set(GUARD_KEY, 'attempt-1');
      mocks.abort.mockResolvedValue({ ok: false, status: 503, error: 'x', kind: 'http' });

      await runRerollRecovery(deps);

      expect(store.get(GUARD_KEY)).toBe('attempt-1');
    });

    it('giving up after the last try releases the guard, even one the dead attempt left', async () => {
      store.set(GUARD_KEY, 'attempt-1');
      mocks.abort.mockResolvedValue({ ok: false, status: 503, error: 'x', kind: 'http' });

      await runRerollRecovery(deps);
      for (let i = 0; i < RECOVERY_RETRY_DELAYS_MS.length; i++) {
        await (schedule.mock.calls[i][0] as () => Promise<void>)();
      }

      expect(mocks.error).toHaveBeenCalled();
      expect(store.has(GUARD_KEY)).toBe(false);
    });

    it('a retry caused by another attempt holding the guard does not consume a try', async () => {
      store.set(GUARD_KEY, 'attempt-2');
      await runRerollRecovery(deps);
      // Five contended retries: more than the retry schedule has tries.
      for (let i = 0; i < RECOVERY_RETRY_DELAYS_MS.length + 2; i++) {
        await (schedule.mock.calls[i][0] as () => Promise<void>)();
      }

      expect(mocks.abort).not.toHaveBeenCalled();
      expect(mocks.error).not.toHaveBeenCalled();
      expect(store.has(KEY)).toBe(true);

      // The other attempt ends and the gateway cannot answer: the retry still has
      // all its tries, so it schedules the FIRST backoff again instead of giving up.
      store.delete(GUARD_KEY);
      mocks.abort.mockResolvedValueOnce({ ok: false, status: 503, error: 'x', kind: 'http' });
      await (schedule.mock.calls[RECOVERY_RETRY_DELAYS_MS.length + 2][0] as () => Promise<void>)();

      expect(mocks.error).not.toHaveBeenCalled();
      expect(schedule.mock.calls.at(-1)?.[1]).toBe(RECOVERY_RETRY_DELAYS_MS[0]);

      // ... and the retry after it settles.
      await (schedule.mock.calls[RECOVERY_RETRY_DELAYS_MS.length + 3][0] as () => Promise<void>)();

      expect(mocks.abort).toHaveBeenCalledTimes(2);
      expect(store.has(KEY)).toBe(false);
    });

    it('a contended record is still bounded by its createdAt cutoff', async () => {
      store.set(GUARD_KEY, 'attempt-2');
      store.set(
        KEY,
        JSON.stringify({ ...record, createdAt: Date.now() - REROLL_INFLIGHT_TTL_MS - 1000 })
      );

      await runRerollRecovery(deps);

      expect(store.has(KEY)).toBe(false);
      expect(schedule).not.toHaveBeenCalled();
      expect(mocks.error).toHaveBeenCalled();
    });

    it('a dropped record releases the dead attempt guard too', async () => {
      store.set(GUARD_KEY, 'attempt-1');
      mocks.abort.mockResolvedValue({ ok: false, status: 404, error: 'x', kind: 'http' });

      await runRerollRecovery(deps);

      expect(store.has(GUARD_KEY)).toBe(false);
    });
  });

  it('an unresolvable edit target (transient webhook failure) is retried, not settled', async () => {
    channelsFetch.mockResolvedValue({
      isTextBased: () => true,
      // A guild channel holding a non-webhook message: `resolveTarget` refuses.
      isDMBased: () => false,
      send: vi.fn(),
      messages: { fetch: fetchMessage },
    });

    const stats = await runRerollRecovery(deps);

    expect(store.has(KEY)).toBe(true);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(stats).toEqual(expect.objectContaining({ retrying: 1, settled: 0 }));
  });

  describe('a refused abort', () => {
    it.each([404, 403, 400])(
      'a definite %i is terminal: the record is dropped with a warning and nothing is retried',
      async status => {
        mocks.abort.mockResolvedValue({ ok: false, status, error: 'x', kind: 'http' });

        const stats = await runRerollRecovery(deps);

        expect(store.has(KEY)).toBe(false);
        expect(schedule).not.toHaveBeenCalled();
        // Only the extras are touched: the originals are never edited back.
        expect(discord.a.edit).not.toHaveBeenCalled();
        expect(mocks.warn).toHaveBeenCalledWith(
          expect.objectContaining({ jobId: 'job-1', rowId: 'row-1', status }),
          expect.any(String)
        );
        expect(stats).toEqual(expect.objectContaining({ dropped: 1, retrying: 0 }));
      }
    );

    it('deletes nothing on Discord: a refusal says nothing about whether the commit landed', async () => {
      mocks.abort.mockResolvedValue({ ok: false, status: 404, error: 'x', kind: 'http' });

      await runRerollRecovery(deps);

      expect(discord.x1.delete).not.toHaveBeenCalled();
      expect(discord.b.delete).not.toHaveBeenCalled();
      expect(store.has(KEY)).toBe(false);
    });

    it.each([408, 429, 503])('%i may be transient: retried', async status => {
      mocks.abort.mockResolvedValue({ ok: false, status, error: 'x', kind: 'http' });

      await runRerollRecovery(deps);

      expect(store.has(KEY)).toBe(true);
      expect(schedule).toHaveBeenCalledTimes(1);
    });
  });

  describe('a record keeps its original schedule across write-backs', () => {
    it('writes it back with createdAt unchanged and only the remaining TTL', async () => {
      mocks.abort.mockResolvedValue({ ok: false, status: 503, error: 'x', kind: 'http' });

      await runRerollRecovery(deps);

      expect(JSON.parse(store.get(KEY) as string).createdAt).toBe(record.createdAt);
      const writeBack = (redis.set as ReturnType<typeof vi.fn>).mock.calls.find(
        call => call[0] === KEY
      ) as unknown[];
      const ttl = writeBack[3] as number;
      expect(ttl).toBeLessThanOrEqual(REROLL_INFLIGHT_TTL_MS - 10 * 60 * 1000);
      expect(ttl).toBeGreaterThan(REROLL_INFLIGHT_TTL_MS - 11 * 60 * 1000);
    });

    it('a record past its original expiry is dropped, not retried or written back', async () => {
      store.set(
        KEY,
        JSON.stringify({ ...record, createdAt: Date.now() - REROLL_INFLIGHT_TTL_MS - 1000 })
      );
      mocks.abort.mockResolvedValue({ ok: false, status: 503, error: 'x', kind: 'http' });

      await runRerollRecovery(deps);

      expect(store.has(KEY)).toBe(false);
      expect(schedule).not.toHaveBeenCalled();
      expect(mocks.error).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: 'job-1' }),
        expect.any(String)
      );
    });
  });

  describe('a record younger than the live-handler window', () => {
    it('is not claimed: it stays exactly as written and nothing is scheduled by the pass (the rescan sees it later)', async () => {
      const young = { ...record, writtenAt: Date.now() - 1000 };
      store.set(KEY, JSON.stringify(young));

      const stats = await runRerollRecovery(deps);

      expect(mocks.abort).not.toHaveBeenCalled();
      expect(JSON.parse(store.get(KEY) as string)).toEqual(young);
      expect(schedule).not.toHaveBeenCalled();
      expect(stats).toEqual(expect.objectContaining({ claimed: 0 }));
    });
  });

  describe('the periodic rescan', () => {
    const rescanFn = (): (() => Promise<void>) => schedule.mock.calls[0][0] as () => Promise<void>;

    it('is never shorter than the minimum record age, and the first pass is scheduled for it', () => {
      expect(REROLL_RECOVERY_RESCAN_MS).toBeGreaterThanOrEqual(REROLL_INFLIGHT_MIN_AGE_MS);

      startRerollRecoveryRescan(deps);

      expect(schedule).toHaveBeenCalledTimes(1);
      expect(schedule).toHaveBeenCalledWith(expect.any(Function), REROLL_RECOVERY_RESCAN_MS);
    });

    it('a record written after the boot scan is picked up by the next rescan, which schedules the one after', async () => {
      store.delete(KEY);
      await runRerollRecovery(deps);
      startRerollRecoveryRescan(deps);
      // The old process writes a record after the boot scan, old enough by the rescan.
      store.set(KEY, JSON.stringify(record));

      await rescanFn()();

      expect(mocks.abort).toHaveBeenCalledTimes(1);
      expect(discord.a.edit).toHaveBeenCalledWith(expect.objectContaining({ content: 'old a' }));
      expect(store.has(KEY)).toBe(false);
      expect(schedule).toHaveBeenCalledTimes(2);
      expect(schedule.mock.calls[1][1]).toBe(REROLL_RECOVERY_RESCAN_MS);
    });

    it('a record claimed out at one rescan is seen at the next', async () => {
      store.delete(KEY);
      startRerollRecoveryRescan(deps);
      await rescanFn()();
      expect(mocks.abort).not.toHaveBeenCalled();
      expect(schedule).toHaveBeenCalledTimes(2);

      // The record was claimed out during the first pass and is written back now.
      store.set(KEY, JSON.stringify(record));
      await (schedule.mock.calls[1][0] as () => Promise<void>)();

      expect(mocks.abort).toHaveBeenCalledTimes(1);
      expect(store.has(KEY)).toBe(false);
      expect(schedule).toHaveBeenCalledTimes(3);
    });

    it('a record that was too young at one rescan is claimed once it has aged, at the next', async () => {
      store.set(KEY, JSON.stringify({ ...record, writtenAt: Date.now() - 1000 }));
      startRerollRecoveryRescan(deps);
      await rescanFn()();
      expect(mocks.abort).not.toHaveBeenCalled();
      expect(schedule).toHaveBeenCalledTimes(2);

      store.set(KEY, JSON.stringify(record));
      await (schedule.mock.calls[1][0] as () => Promise<void>)();

      expect(mocks.abort).toHaveBeenCalledTimes(1);
    });

    it('keeps rescheduling when the scan fails (the scan swallows it, so the pass still ends)', async () => {
      (redis.scan as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('scan down'));
      startRerollRecoveryRescan(deps);

      await expect(rescanFn()()).resolves.toBeUndefined();

      expect(schedule).toHaveBeenCalledTimes(2);
    });

    it('keeps rescheduling, and logs, when the pass itself throws', async () => {
      const throwing = {
        ...deps,
        get client(): Client {
          throw new Error('client gone');
        },
      } as RerollRecoveryDeps;
      startRerollRecoveryRescan(throwing);

      await expect(rescanFn()()).resolves.toBeUndefined();

      expect(mocks.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Reroll recovery rescan failed'
      );
      expect(schedule).toHaveBeenCalledTimes(2);
    });
  });

  describe('handOffToRecovery (a live handler keeps its record)', () => {
    it('schedules the first backoff retry, which claims the record under this boot id and settles it', async () => {
      store.set(KEY, JSON.stringify({ ...record, bootId: 'boot-new' }));

      handOffToRecovery(deps, 'job-1');

      expect(schedule).toHaveBeenCalledTimes(1);
      expect(schedule).toHaveBeenCalledWith(expect.any(Function), RECOVERY_RETRY_DELAYS_MS[0]);
      expect(mocks.abort).not.toHaveBeenCalled();

      await (schedule.mock.calls[0][0] as () => Promise<void>)();

      expect(mocks.abort).toHaveBeenCalledTimes(1);
      expect(discord.a.edit).toHaveBeenCalledWith(expect.objectContaining({ content: 'old a' }));
      expect(store.has(KEY)).toBe(false);
    });
  });

  it('an actor that cannot be fetched is retried, not dropped', async () => {
    (deps.client.users.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('down'));

    await runRerollRecovery(deps);

    expect(mocks.abort).not.toHaveBeenCalled();
    expect(store.has(KEY)).toBe(true);
    expect(schedule).toHaveBeenCalledTimes(1);
  });
});
