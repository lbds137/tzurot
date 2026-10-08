/**
 * Tests for the catalog-drift alert worker processor (the seams that matter:
 * schema gate → ONE owner-channel embed per job naming each drifted config
 * and its missing model id — truncated at Discord's 25-field embed cap).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Client } from 'discord.js';
import { JobType, CATALOG_DRIFT_ALERT_QUEUE_NAME } from '@tzurot/common-types/constants/queue';
import type { CatalogDriftEntry } from '@tzurot/common-types/types/jobs';
import type { Job } from 'bullmq';

const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => mockLogger,
  };
});

const postOwnerChannelEmbedMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/ownerChannel.js', () => ({
  postOwnerChannelEmbed: postOwnerChannelEmbedMock,
}));

// Mock getConfig so setupCatalogDriftAlertWorker() finds a valid REDIS_URL
// without environment setup; parseRedisUrl/createBullMQRedisConfig stay real
// (pure URL parsing, deterministic).
vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return {
    ...actual,
    getConfig: () => actual.createTestConfig({ REDIS_URL: 'redis://localhost:6379' }),
  };
});

const WorkerCtor = vi.hoisted(() => vi.fn());
vi.mock('bullmq', () => ({ Worker: WorkerCtor }));

const { buildCatalogDriftEmbed, createCatalogDriftAlertProcessor, setupCatalogDriftAlertWorker } =
  await import('./setupCatalogDriftAlertWorker.js');

function makePayload(drifts: unknown[]) {
  return {
    requestId: 'catalog-drift-2026-01-01T00-00-00.000Z',
    jobType: JobType.CatalogDriftAlert,
    responseDestination: { type: 'api' },
    drifts,
  };
}

const DRIFTS = [
  {
    configId: '11111111-1111-4111-8111-111111111111',
    configName: 'Free Chat Default',
    modelId: 'qwen/qwen3.8-27b:free',
    kind: 'free-default',
  },
  {
    configId: '33333333-3333-4333-8333-333333333333',
    configName: 'Shared Preset',
    modelId: 'vendor/global-preset-model',
    kind: 'global',
  },
];

function asJob(data: unknown): Job {
  return { id: 'job-1', data } as unknown as Job;
}

/** Deterministic, individually-named drift entries for embed-cap fixtures. */
function makeDrifts(count: number): CatalogDriftEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    configId: `${String(i).padStart(8, '0')}-0000-4000-8000-${String(i).padStart(12, '0')}`,
    configName: `Config ${String(i)}`,
    modelId: `vendor/delisted-${String(i)}`,
    kind: 'global' as const,
  }));
}

interface EmbedLike {
  toJSON: () => {
    title?: string;
    description?: string;
    fields?: { name: string; value: string }[];
  };
}

describe('createCatalogDriftAlertProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postOwnerChannelEmbedMock.mockResolvedValue(true);
  });

  it('posts ONE owner-channel embed per job naming each config and its missing model id', async () => {
    const processor = createCatalogDriftAlertProcessor({ client: {} as unknown as Client });

    const result = await processor(asJob(makePayload(DRIFTS)));

    expect(postOwnerChannelEmbedMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ posted: true, driftCount: 2 });

    const embed = postOwnerChannelEmbedMock.mock.calls[0][1] as EmbedLike;
    const json = embed.toJSON();
    expect(json.title).toContain('OpenRouter catalog');
    const fields = json.fields ?? [];
    // Each drift is a field carrying BOTH the config name (role-labelled) and
    // the missing model id — the two facts the owner needs to re-point it.
    expect(fields).toHaveLength(2);
    expect(fields[0].name).toContain('Free Chat Default');
    expect(fields[0].name).toContain('free default');
    expect(fields[0].value).toContain('qwen/qwen3.8-27b:free');
    expect(fields[1].name).toContain('Shared Preset');
    expect(fields[1].value).toContain('vendor/global-preset-model');
  });

  it('fail-to-skips a malformed payload (no post, no throw)', async () => {
    const processor = createCatalogDriftAlertProcessor({ client: {} as unknown as Client });

    const result = await processor(asJob({ requestId: 'x', drifts: 'not-an-array' }));

    expect(postOwnerChannelEmbedMock).not.toHaveBeenCalled();
    expect(result).toEqual({ posted: false, driftCount: 0 });
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('stays silent when the owner channel post no-ops (FEEDBACK_CHANNEL_ID unset)', async () => {
    postOwnerChannelEmbedMock.mockResolvedValue(false);
    const processor = createCatalogDriftAlertProcessor({ client: {} as unknown as Client });

    const result = await processor(asJob(makePayload([DRIFTS[0]])));

    expect(result).toEqual({ posted: false, driftCount: 1 });
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ driftCount: 1, posted: false }),
      'Catalog drift alert processed'
    );
  });
});

describe('buildCatalogDriftEmbed', () => {
  it('truncates a 30-drift batch inside the 25-field cap: 24 config fields + ONE remainder field', () => {
    const embed = buildCatalogDriftEmbed(makeDrifts(30));
    const fields = embed.toJSON().fields ?? [];

    // 24 config fields + the closing remainder field = 25 fields TOTAL — the
    // cumulative cap @discordjs/builders enforces (a 26th addFields throws).
    expect(fields).toHaveLength(25);
    expect(fields[23].name).toContain('Config 23');
    expect(fields[23].value).toContain('vendor/delisted-23');
    const closing = fields[24];
    expect(closing.value).toContain('6 more configs');
    expect(closing.value).toContain('api-gateway logs');
    // The 25th drift (Config 24) is not rendered as its own field — it rides
    // the remainder count instead.
    expect(fields.map(f => f.name).join('\n')).not.toContain('Config 24');
  });

  it('renders every config field when the batch exactly fills the cap (25 drifts, no remainder field)', () => {
    const embed = buildCatalogDriftEmbed(makeDrifts(25));
    const fields = embed.toJSON().fields ?? [];

    expect(fields).toHaveLength(25);
    expect(fields[24].name).toContain('Config 24');
    expect(fields.some(f => f.value.includes('more configs'))).toBe(false);
  });

  it('renders a small batch in full with NO remainder field', () => {
    const embed = buildCatalogDriftEmbed(makeDrifts(2));
    const fields = embed.toJSON().fields ?? [];

    expect(fields).toHaveLength(2);
    expect(fields[0].name).toContain('Config 0');
    expect(fields[1].name).toContain('Config 1');
    expect(fields.some(f => f.value.includes('more configs'))).toBe(false);
  });

  it('slices an over-long model id to the 1024 field-value cap', () => {
    const [drift] = makeDrifts(1);
    const embed = buildCatalogDriftEmbed([{ ...drift, modelId: 'm'.repeat(2000) }]);
    const fields = embed.toJSON().fields ?? [];

    expect(fields).toHaveLength(1);
    // Both backticks count toward the cap — the raw id is sliced to 1022 and
    // wrapped, so the rendered value is exactly 1024 chars and the code span
    // stays terminated.
    expect(fields[0].value).toHaveLength(1024);
    expect(fields[0].value.startsWith('`')).toBe(true);
    expect(fields[0].value.endsWith('`')).toBe(true);
  });
});

describe('setupCatalogDriftAlertWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    WorkerCtor.mockImplementation(function () {
      return { on: vi.fn() };
    });
  });

  it('constructs the worker not running (autorun: false) so it cannot post before Discord is ready', () => {
    setupCatalogDriftAlertWorker({ client: {} as unknown as Client });

    expect(WorkerCtor).toHaveBeenCalledTimes(1);
    const [queueName, , options] = WorkerCtor.mock.calls[0] as [string, unknown, unknown];
    expect(queueName).toBe(CATALOG_DRIFT_ALERT_QUEUE_NAME);
    expect(options).toEqual(expect.objectContaining({ autorun: false }));
  });
});
