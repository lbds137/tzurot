import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queryMock, executeMock, confirmMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  executeMock: vi.fn(),
  confirmMock: vi.fn().mockResolvedValue(true),
}));

vi.mock('../utils/env-runner.js', () => ({
  validateEnvironment: vi.fn(),
  showEnvironmentBanner: vi.fn(),
  confirmProductionOperation: confirmMock,
}));

vi.mock('./prisma-env.js', () => ({
  getPrismaForEnv: vi.fn().mockResolvedValue({
    prisma: { $queryRawUnsafe: queryMock, $executeRawUnsafe: executeMock },
    disconnect: vi.fn().mockResolvedValue(undefined),
  }),
}));

import {
  analyzeRepairScope,
  executeRepair,
  repairFactTimestamps,
} from './repair-fact-timestamps.js';

beforeEach(() => {
  vi.clearAllMocks();
  confirmMock.mockResolvedValue(true);
});

describe('analyzeRepairScope', () => {
  it('sums bucket counts into a total', async () => {
    queryMock.mockResolvedValue([
      { bucket: 'c: 1-6mo', n: 5742 },
      { bucket: 'd: >6mo', n: 10797 },
    ]);

    const scope = await analyzeRepairScope({
      $queryRawUnsafe: queryMock,
      $executeRawUnsafe: executeMock,
    });

    expect(scope.total).toBe(16539);
    expect(scope.buckets).toHaveLength(2);
    // The scope query must carry every eligibility guard: backward-only
    // (HAVING), and the user-authored exclusions.
    const sql = queryMock.mock.calls[0][0] as string;
    expect(sql).toContain("tier != 'corrected'");
    expect(sql).toContain('is_locked = false');
    expect(sql).toContain('MAX(m.created_at) < mf.valid_from');
  });
});

describe('executeRepair', () => {
  it('updates from the same guarded scope CTE and returns the row count', async () => {
    executeMock.mockResolvedValue(16539);

    const updated = await executeRepair({
      $queryRawUnsafe: queryMock,
      $executeRawUnsafe: executeMock,
    });

    expect(updated).toBe(16539);
    const sql = executeMock.mock.calls[0][0] as string;
    expect(sql).toContain('UPDATE memory_facts');
    expect(sql).toContain('SET valid_from = repair.newest_source');
    // Same eligibility guards as the analysis — the UPDATE must never widen.
    expect(sql).toContain("tier != 'corrected'");
    expect(sql).toContain('is_locked = false');
    expect(sql).toContain('MAX(m.created_at) < mf.valid_from');
  });
});

describe('repairFactTimestamps', () => {
  it('dry-run analyzes but never executes', async () => {
    queryMock.mockResolvedValue([{ bucket: 'd: >6mo', n: 3 }]);

    await repairFactTimestamps({ env: 'dev', dryRun: true });

    expect(queryMock).toHaveBeenCalledOnce();
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('executes the repair when not a dry run', async () => {
    queryMock.mockResolvedValue([{ bucket: 'd: >6mo', n: 3 }]);
    executeMock.mockResolvedValue(3);

    await repairFactTimestamps({ env: 'dev' });

    expect(executeMock).toHaveBeenCalledOnce();
  });

  it('skips execution entirely when nothing is repairable', async () => {
    queryMock.mockResolvedValue([]);

    await repairFactTimestamps({ env: 'dev' });

    expect(executeMock).not.toHaveBeenCalled();
  });

  it('asks for production confirmation and honors a decline', async () => {
    confirmMock.mockResolvedValue(false);

    await repairFactTimestamps({ env: 'prod' });

    expect(confirmMock).toHaveBeenCalledOnce();
    expect(queryMock).not.toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('skips the confirmation on --force', async () => {
    queryMock.mockResolvedValue([{ bucket: 'a: <2d', n: 1 }]);
    executeMock.mockResolvedValue(1);

    await repairFactTimestamps({ env: 'prod', force: true });

    expect(confirmMock).not.toHaveBeenCalled();
    expect(executeMock).toHaveBeenCalledOnce();
  });
});
