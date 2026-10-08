/**
 * Producer half of the api-gateway → bot-client catalog-drift-alert contract.
 *
 * Runs the REAL `CatalogDriftChecker.check()` and snapshots the captured
 * `queue.add` payload (one batched alert) to a committed JSON fixture under
 * `@tzurot/test-utils` (`fixtures/contracts/catalog-drift-alert/`). `--update`
 * regenerates; CI COMPARES (strict). Drift in the checker's alert shape → CI
 * fails here.
 *
 * The consumer half (`tests/e2e/contracts/CatalogDriftAlert.contract.test.ts`)
 * reads the SAME fixture and validates it against the alert worker's entry
 * schema (`catalogDriftAlertJobDataSchema` — the worker's safeParse gate). The
 * committed fixture IS the contract artifact — the two services share data,
 * not code, and the payload is REAL producer output.
 */

import { describe, it, expect, vi } from 'vitest';
import { contractFixtureFile, stableFixtureJson } from '@tzurot/test-utils';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { Redis } from 'ioredis';
import type { Queue } from 'bullmq';

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

// Deterministic scenario: the free-chat default's model is delisted (the
// production shape this check exists for) while everything else resolves.
const POINTER_ROWS = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Global Chat Default',
    model: 'vendor/global-default-model',
  },
];
const GLOBAL_ROWS = [
  {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Shared Preset',
    model: 'vendor/global-preset-model',
  },
];

describe('Contract producer: catalog-drift alert batch (real checker output)', () => {
  it('captures the enqueued alert payload as the committed contract fixture', async () => {
    const prisma = {
      llmConfig: {
        findMany: vi.fn((args: { where?: { isGlobal?: boolean } }) =>
          Promise.resolve(args.where?.isGlobal === true ? GLOBAL_ROWS : POINTER_ROWS)
        ),
      },
    } as unknown as PrismaClient;
    const llmConfigService = {
      getDefaultPointerIds: vi.fn().mockResolvedValue({
        globalDefaultIds: new Set(['11111111-1111-4111-8111-111111111111']),
        freeDefaultIds: new Set<string>(),
      }),
    };
    const modelCache = {
      lookupModelById: vi.fn((modelId: string): Promise<ModelLookup> =>
        Promise.resolve(
          modelId === 'vendor/global-preset-model'
            ? ({ kind: 'absent' } as ModelLookup)
            : RESOLVED_LOOKUP
        )
      ),
    } satisfies Pick<OpenRouterModelCache, 'lookupModelById'>;
    const store = new Map<string, string>();
    const redis = {
      get: (key: string) => Promise.resolve(store.get(key) ?? null),
      set: (key: string, value: string) => {
        store.set(key, value);
        return Promise.resolve('OK');
      },
      del: (key: string) => Promise.resolve(store.delete(key) ? 1 : 0),
    } as unknown as Redis;

    const added: unknown[] = [];
    const queue = {
      add: (name: string, data: unknown, opts?: unknown) => {
        added.push({ name, data, opts });
        return Promise.resolve({ id: 'contract-job' });
      },
    } as unknown as Queue;

    const checker = new CatalogDriftChecker({
      prisma,
      llmConfigService,
      modelCache,
      redis,
      queue,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });
    await checker.check();

    expect(added).toHaveLength(1);
    await expect(stableFixtureJson(added[0])).toMatchFileSnapshot(
      contractFixtureFile('catalog-drift-alert/batch.json')
    );
  });
});
