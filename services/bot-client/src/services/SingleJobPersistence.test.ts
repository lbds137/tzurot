/**
 * SingleJobPersistence Unit Tests
 *
 * The Redis client is the only mocked seam here, so every test asserts the
 * ARGUMENTS crossing it (key, serialized value, TTL) rather than just that a
 * call happened — a persistence layer that wrote the right key with the wrong
 * payload would satisfy a call-count assertion while making recovery a no-op.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Redis } from 'ioredis';
import type { Message } from 'discord.js';
import { REDIS_KEY_PREFIXES } from '@tzurot/common-types/constants/queue';
import { TRACKED_JOB_MAX_LIFETIME_MS, type PendingJobContext } from './JobTracker.js';
import {
  SingleJobContextRecorder,
  SingleJobPersistence,
  SINGLE_JOB_CONTEXT_TTL_SEC,
  toPersistedContext,
  type PersistedJobContext,
} from './SingleJobPersistence.js';

interface FakeRedis {
  set: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  scan: ReturnType<typeof vi.fn>;
  mget: ReturnType<typeof vi.fn>;
}

function createFakeRedis(): FakeRedis {
  return {
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    scan: vi.fn().mockResolvedValue(['0', []]),
    mget: vi.fn().mockResolvedValue([]),
  };
}

const CHANNEL = { id: 'channel-1' } as unknown as PendingJobContext['channel'];
const PERSONALITY = {
  id: 'pers-uuid',
  slug: 'lila',
} as unknown as PendingJobContext['personality'];

function messageContext(): PendingJobContext {
  return {
    kind: 'message',
    channel: CHANNEL,
    guildId: 'guild-1',
    clientId: 'bot-1',
    userMessageTime: new Date('2026-08-29T16:40:03.694Z'),
    personality: PERSONALITY,
    personaId: 'persona-1',
    message: { id: 'msg-1', author: { id: 'user-1' } } as unknown as Message,
    userMessageContent: 'hello there',
    isAutoResponse: true,
  };
}

function slashContext(): PendingJobContext {
  return {
    kind: 'slash',
    channel: CHANNEL,
    guildId: null,
    clientId: undefined,
    userMessageTime: new Date('2026-08-29T16:40:03.694Z'),
    personality: PERSONALITY,
    personaId: 'persona-2',
    characterSlug: 'lila',
    isWeighInMode: true,
    userId: 'user-2',
  };
}

describe('toPersistedContext', () => {
  it('projects a message context onto identifiers, taking userId from the message author', () => {
    const persisted = toPersistedContext('job-1', messageContext(), 1000);

    expect(persisted).toEqual({
      jobId: 'job-1',
      kind: 'message',
      channelId: 'channel-1',
      guildId: 'guild-1',
      clientId: 'bot-1',
      userMessageTime: '2026-08-29T16:40:03.694Z',
      personalityId: 'pers-uuid',
      personalitySlug: 'lila',
      personaId: 'persona-1',
      userId: 'user-1',
      startTime: 1000,
      sourceMessageId: 'msg-1',
      userMessageContent: 'hello there',
      isAutoResponse: true,
    });
  });

  it('projects a slash context, taking userId from the explicit field (no Message anchor)', () => {
    const persisted = toPersistedContext('job-2', slashContext(), 2000);

    expect(persisted).toMatchObject({
      kind: 'slash',
      userId: 'user-2',
      characterSlug: 'lila',
      isWeighInMode: true,
      guildId: null,
    });
    // No sourceMessageId on this variant — recovery must not try to fetch one.
    expect(persisted).not.toHaveProperty('sourceMessageId');
  });

  it('defaults an absent isAutoResponse to false rather than undefined', () => {
    const context = messageContext();
    delete (context as { isAutoResponse?: boolean }).isAutoResponse;

    const persisted = toPersistedContext('job-3', context, 3000);

    expect(persisted).toMatchObject({ kind: 'message', isAutoResponse: false });
  });

  it('round-trips through JSON and back out of the schema unchanged', () => {
    // The value is stored as JSON, so anything the projection produces must
    // survive stringify → parse → validate. A Date left unserialized here
    // would parse back as an object and fail the scan silently.
    const persisted = toPersistedContext('job-4', messageContext(), 4000);
    const reparsed = JSON.parse(JSON.stringify(persisted)) as unknown;

    const fake = createFakeRedis();
    fake.scan.mockResolvedValueOnce(['0', ['singlejob:context:job-4']]);
    fake.mget.mockResolvedValueOnce([JSON.stringify(reparsed)]);

    return expect(new SingleJobPersistence(fake as unknown as Redis).scanAll()).resolves.toEqual([
      persisted,
    ]);
  });
});

describe('SINGLE_JOB_CONTEXT_TTL_SEC', () => {
  it('is derived from the tracker slot lifetime, so the mirror never outlives the slot', () => {
    expect(SINGLE_JOB_CONTEXT_TTL_SEC).toBe(Math.ceil(TRACKED_JOB_MAX_LIFETIME_MS / 1000));
    // 10 min typing cutoff + 30 min orphan grace, as documented on the constant.
    expect(SINGLE_JOB_CONTEXT_TTL_SEC).toBe(2400);
  });
});

describe('SingleJobPersistence', () => {
  let fake: FakeRedis;
  let persistence: SingleJobPersistence;

  beforeEach(() => {
    fake = createFakeRedis();
    persistence = new SingleJobPersistence(fake as unknown as Redis);
  });

  describe('put', () => {
    it('writes the prefixed key with the serialized context and the derived TTL', async () => {
      const context = toPersistedContext('job-put', messageContext(), 5000);

      await persistence.put(context);

      expect(fake.set).toHaveBeenCalledWith(
        `${REDIS_KEY_PREFIXES.SINGLE_JOB_CONTEXT}job-put`,
        JSON.stringify(context),
        'EX',
        SINGLE_JOB_CONTEXT_TTL_SEC
      );
    });

    it('swallows a Redis failure — a submission must never fail on the mirror', async () => {
      fake.set.mockRejectedValue(new Error('Redis down'));

      await expect(
        persistence.put(toPersistedContext('job-err', messageContext(), 6000))
      ).resolves.toBeUndefined();
    });
  });

  describe('delete', () => {
    it('deletes the prefixed key', async () => {
      await persistence.delete('job-del');

      expect(fake.del).toHaveBeenCalledWith(`${REDIS_KEY_PREFIXES.SINGLE_JOB_CONTEXT}job-del`);
    });

    it('swallows a Redis failure — the entry expires via TTL anyway', async () => {
      fake.del.mockRejectedValue(new Error('Redis down'));

      await expect(persistence.delete('job-del-err')).resolves.toBeUndefined();
    });
  });

  describe('scanAll', () => {
    it('scans the prefix with SCAN (not KEYS) and returns parsed contexts', async () => {
      const context = toPersistedContext('job-scan', messageContext(), 7000);
      fake.scan.mockResolvedValueOnce(['0', ['singlejob:context:job-scan']]);
      fake.mget.mockResolvedValueOnce([JSON.stringify(context)]);

      const found = await persistence.scanAll();

      expect(fake.scan).toHaveBeenCalledWith(
        '0',
        'MATCH',
        `${REDIS_KEY_PREFIXES.SINGLE_JOB_CONTEXT}*`,
        'COUNT',
        100
      );
      expect(found).toEqual([context]);
    });

    it('follows the cursor across multiple SCAN pages', async () => {
      const first = toPersistedContext('job-a', messageContext(), 1);
      const second = toPersistedContext('job-b', slashContext(), 2);
      fake.scan
        .mockResolvedValueOnce(['7', ['singlejob:context:job-a']])
        .mockResolvedValueOnce(['0', ['singlejob:context:job-b']]);
      fake.mget
        .mockResolvedValueOnce([JSON.stringify(first)])
        .mockResolvedValueOnce([JSON.stringify(second)]);

      const found = await persistence.scanAll();

      expect(found).toEqual([first, second]);
    });

    it('skips a corrupt JSON value without losing its siblings', async () => {
      const good = toPersistedContext('job-good', messageContext(), 8000);
      fake.scan.mockResolvedValueOnce([
        '0',
        ['singlejob:context:job-bad', 'singlejob:context:job-good'],
      ]);
      fake.mget.mockResolvedValueOnce(['{not json', JSON.stringify(good)]);

      await expect(persistence.scanAll()).resolves.toEqual([good]);
    });

    it('skips a structurally-wrong entry written by an older deploy', async () => {
      // A cast would accept this and hand recovery an undefined channelId.
      fake.scan.mockResolvedValueOnce(['0', ['singlejob:context:job-old']]);
      fake.mget.mockResolvedValueOnce([JSON.stringify({ jobId: 'job-old', kind: 'message' })]);

      await expect(persistence.scanAll()).resolves.toEqual([]);
    });

    it('skips an entry whose `kind` matches no known variant', async () => {
      fake.scan.mockResolvedValueOnce(['0', ['singlejob:context:job-weird']]);
      fake.mget.mockResolvedValueOnce([
        JSON.stringify({
          ...toPersistedContext('job-weird', slashContext(), 1),
          kind: 'telepathy',
        }),
      ]);

      await expect(persistence.scanAll()).resolves.toEqual([]);
    });

    it('skips an oversized value rather than parsing it', async () => {
      fake.scan.mockResolvedValueOnce(['0', ['singlejob:context:job-huge']]);
      fake.mget.mockResolvedValueOnce(['x'.repeat(64 * 1024 + 1)]);

      await expect(persistence.scanAll()).resolves.toEqual([]);
    });
  });
});

describe('SingleJobContextRecorder', () => {
  it('forwards the projected context to put() — the seam recovery depends on', async () => {
    const fake = createFakeRedis();
    const persistence = new SingleJobPersistence(fake as unknown as Redis);
    const putSpy = vi.spyOn(persistence, 'put').mockResolvedValue(undefined);
    const context = messageContext();

    new SingleJobContextRecorder(persistence).record('job-rec', context, 9000);

    expect(putSpy).toHaveBeenCalledWith(toPersistedContext('job-rec', context, 9000));
  });

  it('forwards the jobId to delete() on forget', () => {
    const fake = createFakeRedis();
    const persistence = new SingleJobPersistence(fake as unknown as Redis);
    const delSpy = vi.spyOn(persistence, 'delete').mockResolvedValue(undefined);

    new SingleJobContextRecorder(persistence).forget('job-forget');

    expect(delSpy).toHaveBeenCalledWith('job-forget');
  });

  it('is synchronous and never throws, even when the write rejects', async () => {
    // `record` runs on the per-request submission path, so a Redis outage
    // must not surface there as an unhandled rejection.
    const fake = createFakeRedis();
    const persistence = new SingleJobPersistence(fake as unknown as Redis);
    vi.spyOn(persistence, 'put').mockRejectedValue(new Error('Redis down'));

    expect(() =>
      new SingleJobContextRecorder(persistence).record('job-boom', messageContext(), 1)
    ).not.toThrow();
    await Promise.resolve();
  });

  it('never throws when the SYNCHRONOUS projection fails, not just the write', () => {
    // `toPersistedContext` evaluates as an argument expression, before `put`
    // is called, so a promise handler cannot see it throw. A context whose
    // `personality` is absent reproduces that: the projection dereferences
    // `.id` on it while building the base object.
    const fake = createFakeRedis();
    const persistence = new SingleJobPersistence(fake as unknown as Redis);
    const putSpy = vi.spyOn(persistence, 'put').mockResolvedValue(undefined);
    const broken = { ...messageContext(), personality: undefined } as unknown as PendingJobContext;

    expect(() =>
      new SingleJobContextRecorder(persistence).record('job-proj', broken, 1)
    ).not.toThrow();
    // The projection died before the write, so nothing reached Redis.
    expect(putSpy).not.toHaveBeenCalled();
  });
});

/**
 * Sequencing test (Core Principle 7): the write and the read are separate
 * units whose own tests each construct their own fixtures, so neither can
 * observe what the other produced. This one runs record → scanAll in order
 * against a single in-memory store, which is the only place a key-format or
 * serialization mismatch between the two halves would surface.
 */
describe('write → recover sequencing', () => {
  /**
   * A real-enough Redis: one in-memory map that `set`/`del` mutate and
   * `scan`/`mget` read back, so the write and the read observe each other.
   */
  function createStoreBackedRedis(): { store: Map<string, string>; redis: Redis } {
    const store = new Map<string, string>();
    const fake = {
      set: vi.fn((key: string, value: string) => {
        store.set(key, value);
        return Promise.resolve('OK');
      }),
      del: vi.fn((key: string) => {
        store.delete(key);
        return Promise.resolve(1);
      }),
      scan: vi.fn(() => Promise.resolve(['0', [...store.keys()]])),
      mget: vi.fn((...keys: string[]) => Promise.resolve(keys.map(k => store.get(k) ?? null))),
    };
    return { store, redis: fake as unknown as Redis };
  }

  it('a context recorded by the tracker seam is readable by the recovery scan', async () => {
    const { store, redis } = createStoreBackedRedis();
    const persistence = new SingleJobPersistence(redis);
    const recorder = new SingleJobContextRecorder(persistence);
    const context = messageContext();

    recorder.record('job-seq', context, 12345);
    await vi.waitFor(() => expect(store.size).toBe(1));

    const recovered = await persistence.scanAll();

    expect(recovered).toHaveLength(1);
    const entry = recovered[0] as PersistedJobContext;
    expect(entry.jobId).toBe('job-seq');
    expect(entry.startTime).toBe(12345);
    expect(entry.channelId).toBe('channel-1');
    expect(entry.kind).toBe('message');

    // And the forget half removes exactly what record wrote.
    recorder.forget('job-seq');
    await vi.waitFor(() => expect(store.size).toBe(0));
  });

  it('a system-default persona survives the round trip', async () => {
    // `personaId: ''` means "system default — no real persona", a legitimate
    // value rather than a missing one. Tightening the schema field to
    // `.min(1)` would make this entry fail shape validation, and `scanAll`
    // skips what fails validation — so recovery would silently discard a
    // recoverable job, which is the exact drop this layer exists to prevent.
    const { store, redis } = createStoreBackedRedis();
    const persistence = new SingleJobPersistence(redis);
    const recorder = new SingleJobContextRecorder(persistence);

    recorder.record('job-default-persona', { ...messageContext(), personaId: '' }, 500);
    await vi.waitFor(() => expect(store.size).toBe(1));

    const recovered = await persistence.scanAll();

    expect(recovered).toHaveLength(1);
    expect((recovered[0] as PersistedJobContext).personaId).toBe('');
  });
});
