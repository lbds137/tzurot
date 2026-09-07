import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JobType } from '@tzurot/common-types/constants/queue';
import { UsageError } from '../utils/errors.js';

const { queueAddMock, queueCloseMock, queryMock, executeMock, redisGetMock, redisQuitMock } =
  vi.hoisted(() => ({
    queueAddMock: vi.fn().mockResolvedValue({}),
    queueCloseMock: vi.fn().mockResolvedValue(undefined),
    queryMock: vi.fn(),
    executeMock: vi.fn().mockResolvedValue(1),
    redisGetMock: vi.fn().mockResolvedValue(null),
    redisQuitMock: vi.fn().mockResolvedValue(undefined),
  }));

vi.mock('../utils/env-runner.js', () => ({
  validateEnvironment: vi.fn(),
  showEnvironmentBanner: vi.fn(),
  requireProductionConfirmation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./prisma-env.js', () => ({
  getPrismaForEnv: vi.fn().mockResolvedValue({
    prisma: { $queryRawUnsafe: queryMock, $executeRawUnsafe: executeMock },
    disconnect: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../inspect/bullmqConnection.js', () => ({
  getRailwayRedisUrl: vi.fn().mockResolvedValue('redis://proxy.example:1234'),
  createInspectorQueue: vi.fn().mockImplementation((_url: string, name: string) => ({
    name,
    add: queueAddMock,
    close: queueCloseMock,
  })),
  createInspectorRedis: vi.fn().mockImplementation(() => ({
    get: redisGetMock,
    quit: redisQuitMock,
  })),
}));

import { summarizeSweep } from './summarize-sweep.js';
import { createInspectorQueue, getRailwayRedisUrl } from '../inspect/bullmqConnection.js';
import { requireProductionConfirmation } from '../utils/env-runner.js';
import { getPrismaForEnv, type PrismaEnvConnection } from './prisma-env.js';

const PERSONALITY_ID = '4f9b0f66-3333-4000-8000-00000000000a';
const MEM = (n: number): string =>
  `4f9b0f66-3333-4000-8000-0000000000${String(n).padStart(2, '0')}`;

const WINDOW_COUNTS_ROW = {
  total_non_chunk: 100,
  retrieved_in_window: 50,
  done_current: 40,
  done_older: 3,
  done_newer: 2,
  pending: 2,
  failed: 1,
  dead: 2,
  never_attempted: 0,
};

/** Route $queryRawUnsafe by a distinctive substring of the SQL text, since
 *  hot/cold selection are optional per test and positional mocks would be
 *  fragile to that branching. */
function routeQuery(
  hotRows: { id: string; content_chars: number }[],
  coldRows: { id: string; content_chars: number }[] = []
): void {
  queryMock.mockImplementation((sql: string) => {
    if (sql.includes('FROM personalities')) {
      return Promise.resolve([{ id: PERSONALITY_ID }]);
    }
    if (sql.includes('retrieval_count DESC')) {
      return Promise.resolve(hotRows);
    }
    if (sql.includes('ORDER BY created_at DESC')) {
      return Promise.resolve(coldRows);
    }
    if (sql.includes('total_non_chunk')) {
      return Promise.resolve([WINDOW_COUNTS_ROW]);
    }
    if (sql.includes('memory_facts f')) {
      return Promise.resolve([{ covered: 10 }]);
    }
    if (sql.includes('error_class')) {
      return Promise.resolve([]);
    }
    throw new Error(`unexpected query: ${sql}`);
  });
}

describe('summarizeSweep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queueAddMock.mockResolvedValue({});
    queueCloseMock.mockResolvedValue(undefined);
    executeMock.mockResolvedValue(1);
    redisGetMock.mockResolvedValue(null);
    redisQuitMock.mockResolvedValue(undefined);
    vi.mocked(getRailwayRedisUrl).mockResolvedValue('redis://proxy.example:1234');
    routeQuery([{ id: MEM(1), content_chars: 40 }]);
  });

  it('MEM-ARCH-029: enqueues the exact buildArchiveSummaryJobData payload with reason=sweep and priority 10', async () => {
    await summarizeSweep({ env: 'dev', personality: 'test-persona' });

    expect(createInspectorQueue).toHaveBeenCalledWith(
      'redis://proxy.example:1234',
      'archive-summary'
    );
    expect(queueAddMock).toHaveBeenCalledWith(
      JobType.ArchiveSummary,
      {
        requestId: `archive-summary-${MEM(1)}`,
        jobType: JobType.ArchiveSummary,
        responseDestination: { type: 'api' },
        version: 1,
        memoryId: MEM(1),
        personalityId: PERSONALITY_ID,
        reason: 'sweep',
      },
      {
        jobId: MEM(1),
        priority: 10,
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: true,
      }
    );
  });

  it('MEM-ARCH-029: --dry-run enqueues nothing and stamps nothing', async () => {
    await summarizeSweep({ env: 'dev', personality: 'test-persona', dryRun: true });

    expect(queueAddMock).not.toHaveBeenCalled();
    expect(createInspectorQueue).not.toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('an unknown slug rejects with UsageError', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('FROM personalities')) {
        return Promise.resolve([]);
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    await expect(summarizeSweep({ env: 'dev', personality: 'no-such-slug' })).rejects.toThrow(
      UsageError
    );
  });

  it('batches the pending stamp at 200 ids (201 rows -> two stamp calls)', async () => {
    const rows = Array.from({ length: 201 }, (_, i) => ({
      id: `4f9b0f66-4444-4000-8000-${String(i).padStart(12, '0')}`,
      content_chars: 10,
    }));
    routeQuery(rows);

    await summarizeSweep({ env: 'dev', personality: 'test-persona', limit: 500 });

    expect(executeMock).toHaveBeenCalledTimes(2);
    expect(executeMock.mock.calls[0][1]).toHaveLength(200);
    expect(executeMock.mock.calls[1][1]).toHaveLength(1);
  });

  it('interleaves the stamp with the enqueue loop: the first stamp lands after exactly 200 adds and before the 201st', async () => {
    const rows = Array.from({ length: 201 }, (_, i) => ({
      id: `4f9b0f66-4444-4000-8000-${String(i).padStart(12, '0')}`,
      content_chars: 10,
    }));
    routeQuery(rows);

    const order: string[] = [];
    queueAddMock.mockImplementation(() => {
      order.push('add');
      return Promise.resolve({});
    });
    executeMock.mockImplementation(() => {
      order.push('stamp');
      return Promise.resolve(1);
    });

    await summarizeSweep({ env: 'dev', personality: 'test-persona', limit: 500 });

    const firstStampIndex = order.indexOf('stamp');
    // The first stamp must land right after the 200th add (index 199, 0-based) —
    // not after all 201 adds, which is what an un-interleaved (enqueue-all-then-
    // stamp-all) implementation would produce.
    expect(firstStampIndex).toBe(200);
    expect(order.slice(0, 200)).toEqual(Array(200).fill('add'));
    expect(order[200]).toBe('stamp');
    expect(order[201]).toBe('add'); // the 201st add, AFTER the first stamp
    expect(order[202]).toBe('stamp'); // the final partial-batch stamp
    expect(order).toHaveLength(203);
  });

  it('--include-cold runs the cold selection; plain mode does not', async () => {
    routeQuery([{ id: MEM(1), content_chars: 40 }], [{ id: MEM(2), content_chars: 60 }]);

    await summarizeSweep({
      env: 'dev',
      personality: 'test-persona',
      includeCold: true,
      dryRun: true,
    });

    const coldCalls = queryMock.mock.calls.filter(call =>
      (call[0] as string).includes('ORDER BY created_at DESC')
    );
    expect(coldCalls.length).toBeGreaterThan(0);

    vi.clearAllMocks();
    routeQuery([{ id: MEM(1), content_chars: 40 }], [{ id: MEM(2), content_chars: 60 }]);
    await summarizeSweep({ env: 'dev', personality: 'test-persona', dryRun: true });

    const coldCallsPlain = queryMock.mock.calls.filter(call =>
      (call[0] as string).includes('ORDER BY created_at DESC')
    );
    expect(coldCallsPlain.length).toBe(0);
  });

  it('rejects a non-positive --limit', async () => {
    await expect(
      summarizeSweep({ env: 'dev', personality: 'test-persona', limit: 0 })
    ).rejects.toThrow(UsageError);
  });

  it('rejects a non-positive --window', async () => {
    await expect(
      summarizeSweep({ env: 'dev', personality: 'test-persona', windowDays: 0 })
    ).rejects.toThrow(UsageError);
  });

  it('MEM-ARCH-029: a declined prod confirmation ABORTS the run before any enqueue', async () => {
    // The real gate exits the process on decline (it never returns declined);
    // the mock simulates that non-return by rejecting with a sentinel. The
    // slug is resolved BEFORE the confirmation (Fix 3), so queryMock has
    // been called by this point — only the enqueue must not happen.
    vi.mocked(requireProductionConfirmation).mockRejectedValueOnce(new Error('exit: declined'));

    await expect(summarizeSweep({ env: 'prod', personality: 'test-persona' })).rejects.toThrow(
      'exit: declined'
    );

    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it('MEM-ARCH-029: an unknown slug on prod fails before the confirmation prompt', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('FROM personalities')) {
        return Promise.resolve([]);
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    await expect(summarizeSweep({ env: 'prod', personality: 'no-such-slug' })).rejects.toThrow(
      UsageError
    );

    expect(requireProductionConfirmation).not.toHaveBeenCalled();
  });

  it('MEM-ARCH-029: --force bypasses the prod confirmation', async () => {
    await summarizeSweep({ env: 'prod', personality: 'test-persona', force: true });

    expect(requireProductionConfirmation).not.toHaveBeenCalled();
    expect(queueAddMock).toHaveBeenCalled();
  });

  it('MEM-ARCH-029: --dry-run on prod asks for no confirmation', async () => {
    await summarizeSweep({ env: 'prod', personality: 'test-persona', dryRun: true });

    expect(requireProductionConfirmation).not.toHaveBeenCalled();
  });

  it('MEM-ARCH-030: prints the switch states and warns when the model switch is off', async () => {
    const findUniqueMock = vi.fn().mockResolvedValue({
      systemSettings: {
        archiveSummaryModelEnabled: false,
        archiveSummaryEnqueueEnabled: true,
        archiveSummaryDailyCap: 2000,
      },
    });
    vi.mocked(getPrismaForEnv).mockResolvedValueOnce({
      prisma: {
        $queryRawUnsafe: queryMock,
        $executeRawUnsafe: executeMock,
        adminSettings: { findUnique: findUniqueMock },
      },
      disconnect: vi.fn().mockResolvedValue(undefined),
    } as unknown as PrismaEnvConnection);

    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await summarizeSweep({ env: 'dev', personality: 'test-persona', dryRun: true });

    const lines = spy.mock.calls.map(call => String(call[0]));
    expect(
      lines.some(line => line.includes('archiveSummaryDailyCap:') && line.includes('2000'))
    ).toBe(true);
    expect(
      lines.some(line => line.includes('archiveSummaryEnqueueEnabled:') && line.includes('true'))
    ).toBe(true);
    expect(
      lines.some(line => line.includes('archiveSummaryModelEnabled:') && line.includes('false'))
    ).toBe(true);
    expect(lines.some(line => line.includes('Model switch is off'))).toBe(true);

    spy.mockRestore();
  });

  it('MEM-ARCH-030: prints dead rows grouped by error class when any exist', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('FROM personalities')) {
        return Promise.resolve([{ id: PERSONALITY_ID }]);
      }
      if (sql.includes('retrieval_count DESC')) {
        return Promise.resolve([{ id: MEM(1), content_chars: 40 }]);
      }
      if (sql.includes('ORDER BY created_at DESC')) {
        return Promise.resolve([]);
      }
      if (sql.includes('total_non_chunk')) {
        return Promise.resolve([WINDOW_COUNTS_ROW]);
      }
      if (sql.includes('memory_facts f')) {
        return Promise.resolve([{ covered: 10 }]);
      }
      if (sql.includes('error_class')) {
        return Promise.resolve([
          { error_class: 'no_template', row_count: 3 },
          { error_class: 'overflow', row_count: 1 },
        ]);
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await summarizeSweep({ env: 'dev', personality: 'test-persona', dryRun: true });

    const lines = spy.mock.calls.map(call => String(call[0]));
    expect(lines.some(line => line.includes('no_template') && line.includes('3'))).toBe(true);
    expect(lines.some(line => line.includes('overflow') && line.includes('1'))).toBe(true);

    spy.mockRestore();
  });

  it('resolves the Redis URL once per run', async () => {
    await summarizeSweep({ env: 'dev', personality: 'test-persona' });

    expect(getRailwayRedisUrl).toHaveBeenCalledTimes(1);
  });

  it('MEM-ARCH-029: an unresolvable Redis URL aborts before any enqueue', async () => {
    vi.mocked(getRailwayRedisUrl).mockResolvedValueOnce(null);

    await expect(summarizeSweep({ env: 'dev', personality: 'test-persona' })).rejects.toThrow(
      'Could not resolve a Redis URL for dev'
    );

    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it('MEM-ARCH-030: warns that the model switch may be off when settings are unavailable', async () => {
    // The default mocked prisma has no `adminSettings` — SystemSettingsService's
    // refresh() throws and never sets hasLoadedOnce, landing the unavailable branch.
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await summarizeSweep({ env: 'dev', personality: 'test-persona', dryRun: true });

    const lines = spy.mock.calls.map(call => String(call[0]));
    expect(
      lines.some(line => line.includes('Settings unavailable') && line.includes('may be off'))
    ).toBe(true);

    spy.mockRestore();
  });

  /** Mocks a loaded settings row with `archiveSummaryEnqueueEnabled: false`. */
  function mockEnqueueSwitchOff(): void {
    const findUniqueMock = vi.fn().mockResolvedValue({
      systemSettings: {
        archiveSummaryEnqueueEnabled: false,
        archiveSummaryModelEnabled: true,
        archiveSummaryDailyCap: 2000,
      },
    });
    vi.mocked(getPrismaForEnv).mockResolvedValueOnce({
      prisma: {
        $queryRawUnsafe: queryMock,
        $executeRawUnsafe: executeMock,
        adminSettings: { findUnique: findUniqueMock },
      },
      disconnect: vi.fn().mockResolvedValue(undefined),
    } as unknown as PrismaEnvConnection);
  }

  it('MEM-ARCH-029: refuses to enqueue while archiveSummaryEnqueueEnabled is off', async () => {
    mockEnqueueSwitchOff();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(summarizeSweep({ env: 'dev', personality: 'test-persona' })).rejects.toThrow(
      'archiveSummaryEnqueueEnabled is off'
    );

    expect(queueAddMock).not.toHaveBeenCalled();
    const lines = spy.mock.calls.map(call => String(call[0]));
    expect(lines.some(line => line.includes('Sweep report:'))).toBe(true);

    spy.mockRestore();
  });

  it('MEM-ARCH-029: --force does not override the enqueue switch', async () => {
    mockEnqueueSwitchOff();

    await expect(
      summarizeSweep({ env: 'dev', personality: 'test-persona', force: true })
    ).rejects.toThrow('archiveSummaryEnqueueEnabled is off');

    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it('MEM-ARCH-029: --dry-run still reports while the switch is off', async () => {
    mockEnqueueSwitchOff();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await summarizeSweep({ env: 'dev', personality: 'test-persona', dryRun: true });

    expect(queueAddMock).not.toHaveBeenCalled();
    const lines = spy.mock.calls.map(call => String(call[0]));
    expect(lines.some(line => line.includes('Sweep report:'))).toBe(true);
    expect(
      lines.some(line => line.includes('archiveSummaryEnqueueEnabled:') && line.includes('false'))
    ).toBe(true);

    spy.mockRestore();
  });

  it('the budget line still prints 7 when redis.quit() rejects after a successful get()', async () => {
    redisGetMock.mockResolvedValueOnce('7');
    redisQuitMock.mockRejectedValueOnce(new Error('quit failed'));
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await summarizeSweep({ env: 'dev', personality: 'test-persona', dryRun: true });

    const lines = spy.mock.calls.map(call => String(call[0]));
    expect(lines.some(line => line.includes('archiveSummaryBudget (today): 7'))).toBe(true);

    spy.mockRestore();
  });
});
