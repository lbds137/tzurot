/**
 * Tests for CatalogDriftChecker — the post-refresh check that alerts the
 * owner channel when a configured default/global model id no longer resolves
 * against the OpenRouter catalog.
 *
 * Every collaborator is faked at its natural seam (Prisma, pointer service,
 * model cache, Redis, BullMQ queue); `addValidatedJob` runs REAL, so each
 * enqueued payload is also exercised against the catalog-drift job schema.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Redis } from 'ioredis';
import type { Queue } from 'bullmq';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { JobType, REDIS_KEY_PREFIXES } from '@tzurot/common-types/constants/queue';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

import { CatalogDriftChecker } from './CatalogDriftChecker.js';
import type { ModelLookup, OpenRouterModelCache } from './OpenRouterModelCache.js';

/** A complete resolved-lookup value — the checker reads only `kind`, but the
 * fixture stays structurally honest so a ModelLookup shape change breaks here. */
const RESOLVED_LOOKUP: ModelLookup = {
  kind: 'resolved',
  model: {
    id: 'resolved-model',
    name: 'Resolved Model',
    contextLength: 128000,
    supportsVision: false,
    supportsImageGeneration: false,
    supportsAudioInput: false,
    supportsAudioOutput: false,
    promptPricePerMillion: 0,
    completionPricePerMillion: 0,
    isRouter: false,
    created: 1700000000,
  },
};

/** Fixed config ids so sentinel keys are predictable in assertions. */
const GLOBAL_CHAT_DEFAULT_ID = '11111111-1111-4111-8111-111111111111';
const FREE_CHAT_DEFAULT_ID = '22222222-2222-4222-8222-222222222222';
const GLOBAL_PRESET_ID = '33333333-3333-4333-8333-333333333333';
const DUAL_ROLE_ID = '44444444-4444-4444-8444-444444444444';

const POINTER_ROWS = [
  { id: GLOBAL_CHAT_DEFAULT_ID, name: 'Global Chat Default', model: 'vendor/global-default-model' },
  { id: FREE_CHAT_DEFAULT_ID, name: 'Free Chat Default', model: 'vendor/free-default-model' },
  { id: DUAL_ROLE_ID, name: 'Dual Role Config', model: 'vendor/dual-role-model' },
];

const GLOBAL_ROWS = [
  { id: GLOBAL_PRESET_ID, name: 'Shared Preset', model: 'vendor/global-preset-model' },
  { id: DUAL_ROLE_ID, name: 'Dual Role Config', model: 'vendor/dual-role-model' },
];

const FIXED_NOW = new Date('2026-01-01T00:00:00.000Z');

/** In-memory Redis sentinel fake — get/set/del only, per the checker's Pick. */
function createFakeRedis(): {
  redis: Pick<Redis, 'get' | 'set' | 'del'>;
  store: Map<string, string>;
} {
  const store = new Map<string, string>();
  return {
    store,
    redis: {
      get: (key: string) => Promise.resolve(store.get(key) ?? null),
      set: (key: string, value: string) => {
        store.set(key, value);
        return Promise.resolve('OK');
      },
      del: (key: string) => Promise.resolve(store.delete(key) ? 1 : 0),
    } as unknown as Pick<Redis, 'get' | 'set' | 'del'>,
  };
}

function buildChecker(overrides?: {
  lookups?: Record<string, 'resolved' | 'absent' | 'unavailable'>;
  redis?: Pick<Redis, 'get' | 'set' | 'del'>;
  pointerRows?: typeof POINTER_ROWS;
  globalRows?: typeof GLOBAL_ROWS;
  pointerIds?: { globalDefaultIds: string[]; freeDefaultIds: string[] };
}): {
  checker: CatalogDriftChecker;
  add: ReturnType<typeof vi.fn>;
  redisStore: Map<string, string>;
} {
  const lookups = overrides?.lookups ?? {};
  const pointerRows = overrides?.pointerRows ?? POINTER_ROWS;
  const globalRows = overrides?.globalRows ?? GLOBAL_ROWS;
  const pointerIds = overrides?.pointerIds ?? {
    globalDefaultIds: [GLOBAL_CHAT_DEFAULT_ID, DUAL_ROLE_ID],
    freeDefaultIds: [FREE_CHAT_DEFAULT_ID],
  };
  const fake =
    overrides?.redis !== undefined
      ? { redis: overrides.redis, store: new Map() }
      : createFakeRedis();

  const prisma = {
    llmConfig: {
      // The checker issues two findManys per cycle: pointer-row resolution
      // (id in) and the isGlobal enumeration — distinguished by their where.
      findMany: vi.fn((args: { where?: { isGlobal?: boolean } }) =>
        Promise.resolve(args.where?.isGlobal === true ? globalRows : pointerRows)
      ),
    },
  } as unknown as PrismaClient;

  const llmConfigService = {
    getDefaultPointerIds: vi.fn().mockResolvedValue({
      globalDefaultIds: new Set(pointerIds.globalDefaultIds),
      freeDefaultIds: new Set(pointerIds.freeDefaultIds),
    }),
  };

  const modelCache = {
    lookupModelById: vi.fn((modelId: string): Promise<ModelLookup> => {
      const kind = lookups[modelId] ?? 'resolved';
      return Promise.resolve(kind === 'resolved' ? RESOLVED_LOOKUP : ({ kind } as ModelLookup));
    }),
  } satisfies Pick<OpenRouterModelCache, 'lookupModelById'>;

  const add = vi.fn().mockResolvedValue({ id: 'job-1' });
  const queue = { add } as unknown as Queue;

  const checker = new CatalogDriftChecker({
    prisma,
    llmConfigService,
    modelCache,
    redis: fake.redis,
    queue,
    now: () => FIXED_NOW,
  });
  return { checker, add, redisStore: fake.store };
}

describe('CatalogDriftChecker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enqueues one owner alert for a newly-absent model and suppresses the next cycle', async () => {
    // The production shape this exists for: the admin free default's model is
    // delisted (qwen/qwen3.8-27b:free) — first cycle alerts, second is silent.
    const { checker, add, redisStore } = buildChecker({
      lookups: { 'vendor/free-default-model': 'absent' },
    });

    await checker.check();
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      JobType.CatalogDriftAlert,
      expect.objectContaining({
        jobType: JobType.CatalogDriftAlert,
        drifts: [
          expect.objectContaining({
            configId: FREE_CHAT_DEFAULT_ID,
            modelId: 'vendor/free-default-model',
            kind: 'free-default',
          }),
        ],
      }),
      expect.objectContaining({ jobId: 'catalog-drift-2026-01-01T00-00-00.000Z' })
    );
    expect(
      redisStore.has(
        `${REDIS_KEY_PREFIXES.CATALOG_DRIFT_SENTINEL}${FREE_CHAT_DEFAULT_ID}:vendor/free-default-model`
      )
    ).toBe(true);

    add.mockClear();
    await checker.check();
    expect(add).not.toHaveBeenCalled();
  });

  it('treats an unreachable catalog lookup (unavailable) as drift too', async () => {
    const { checker, add } = buildChecker({
      lookups: { 'vendor/global-default-model': 'unavailable' },
    });

    await checker.check();

    expect(add).toHaveBeenCalledTimes(1);
  });

  it('checks the four default pointers AND every isGlobal preset row', async () => {
    // One pointer drift (global chat default) + one global-preset drift in the
    // same cycle — both must be named, with their role kinds.
    const { checker, add } = buildChecker({
      lookups: {
        'vendor/global-default-model': 'absent',
        'vendor/global-preset-model': 'absent',
      },
    });

    await checker.check();

    expect(add).toHaveBeenCalledTimes(1);
    const payload = add.mock.calls[0][1] as { drifts: { configId: string; kind: string }[] };
    const kindsByConfig = new Map(payload.drifts.map(d => [d.configId, d.kind]));
    expect(kindsByConfig.get(GLOBAL_CHAT_DEFAULT_ID)).toBe('default');
    expect(kindsByConfig.get(GLOBAL_PRESET_ID)).toBe('global');
    expect(payload.drifts).toHaveLength(2);
  });

  it('skips dangling pointer ids and rows whose model is empty', async () => {
    const EMPTY_POINTER_ID = '55555555-5555-4555-8555-555555555555';
    const { checker, add } = buildChecker({
      // The empty model id must classify as drift IF it ever reaches
      // evaluation — otherwise a deleted model guard could resolve-and-skip
      // the row silently, keeping this test green either way.
      lookups: { '': 'absent' },
      pointerRows: [{ id: EMPTY_POINTER_ID, name: 'Empty Model', model: '' }],
      // The empty-model row IS a pointer-set member, so only the model guard
      // can drop it; the two default ids dangle (set members with no row) and
      // must contribute nothing.
      pointerIds: {
        globalDefaultIds: [GLOBAL_CHAT_DEFAULT_ID, EMPTY_POINTER_ID],
        freeDefaultIds: [FREE_CHAT_DEFAULT_ID],
      },
      globalRows: [{ id: '66666666-6666-4666-8666-666666666666', name: 'Empty Global', model: '' }],
    });

    await checker.check();

    expect(add).not.toHaveBeenCalled();
  });

  it("batches all of a cycle's drifts into ONE job", async () => {
    const { checker, add } = buildChecker({
      lookups: {
        'vendor/global-default-model': 'absent',
        'vendor/free-default-model': 'absent',
        'vendor/global-preset-model': 'absent',
      },
    });

    await checker.check();

    expect(add).toHaveBeenCalledTimes(1);
    const payload = add.mock.calls[0][1] as { drifts: unknown[] };
    expect(payload.drifts).toHaveLength(3);
  });

  it('rides both role entries on one sentinel when a config is pointer target AND global preset', async () => {
    const { checker, add, redisStore } = buildChecker({
      lookups: { 'vendor/dual-role-model': 'absent' },
    });

    await checker.check();

    expect(add).toHaveBeenCalledTimes(1);
    const payload = add.mock.calls[0][1] as { drifts: { configId: string; kind: string }[] };
    const dualKinds = payload.drifts.filter(d => d.configId === DUAL_ROLE_ID).map(d => d.kind);
    expect(dualKinds).toEqual(['default', 'global']);
    const sentinelCount = [...redisStore.keys()].filter(k =>
      k.startsWith(REDIS_KEY_PREFIXES.CATALOG_DRIFT_SENTINEL)
    );
    expect(sentinelCount).toHaveLength(1);
  });

  it('clears the sentinel on recovery so a later delisting alerts again', async () => {
    const lookups = { 'vendor/global-preset-model': 'absent' } as Record<
      string,
      'resolved' | 'absent' | 'unavailable'
    >;
    const { checker, add, redisStore } = buildChecker({ lookups });

    // Cycle 1: delisted — alert + sentinel.
    await checker.check();
    expect(add).toHaveBeenCalledTimes(1);
    const sentinelKey = `${REDIS_KEY_PREFIXES.CATALOG_DRIFT_SENTINEL}${GLOBAL_PRESET_ID}:vendor/global-preset-model`;
    expect(redisStore.has(sentinelKey)).toBe(true);

    // Cycle 2: model is back — no alert, sentinel cleared.
    lookups['vendor/global-preset-model'] = 'resolved';
    await checker.check();
    expect(add).toHaveBeenCalledTimes(1);
    expect(redisStore.has(sentinelKey)).toBe(false);

    // Cycle 3: delisted AGAIN — a fresh alert must go out.
    lookups['vendor/global-preset-model'] = 'absent';
    await checker.check();
    expect(add).toHaveBeenCalledTimes(2);
  });

  it('fails open on a Redis error: no alert this cycle, and it never throws', async () => {
    const failingRedis = {
      get: vi.fn().mockRejectedValue(new Error('redis down')),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(0),
    } as unknown as Pick<Redis, 'get' | 'set' | 'del'>;
    const { checker, add } = buildChecker({
      lookups: { 'vendor/global-default-model': 'absent' },
      redis: failingRedis,
    });

    await expect(checker.check()).resolves.toBeUndefined();
    expect(add).not.toHaveBeenCalled();
  });

  it('enqueues nothing when every configured model resolves', async () => {
    const { checker, add } = buildChecker({ lookups: {} });

    await checker.check();

    expect(add).not.toHaveBeenCalled();
  });
});
