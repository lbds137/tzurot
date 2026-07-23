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

vi.mock('../memory/prisma-env.js', () => ({
  getPrismaForEnv: vi.fn().mockResolvedValue({
    prisma: { $queryRawUnsafe: queryMock, $executeRawUnsafe: executeMock },
    disconnect: vi.fn().mockResolvedValue(undefined),
  }),
}));

import { analyzeScope, executeBackfill, backfillLastActive } from './backfill-last-active.js';

beforeEach(() => {
  vi.clearAllMocks();
  confirmMock.mockResolvedValue(true);
});

describe('analyzeScope', () => {
  it('sums bucket counts into a total', async () => {
    queryMock.mockResolvedValue([
      { bucket: 'a: <30d (active)', n: 40 },
      { bucket: 'c: >180d (already past the inactivity window)', n: 26 },
    ]);

    const scope = await analyzeScope({
      $queryRawUnsafe: queryMock,
      $executeRawUnsafe: executeMock,
    });

    expect(scope.total).toBe(66);
    expect(scope.buckets).toHaveLength(2);
    // The scope query must carry every activity source AND the forward-only guard.
    const sql = queryMock.mock.calls[0][0] as string;
    expect(sql).toContain('FROM usage_logs ul');
    expect(sql).toContain('JOIN personas p ON p.id = ch.persona_id');
    expect(sql).toContain('FROM personalities pl');
    expect(sql).toContain('JOIN personas mp ON mp.id = m.persona_id');
    // Forward-only / idempotent guard.
    expect(sql).toContain('u.last_active_at IS NULL OR latest.last_active > u.last_active_at');
    // The unsafe-inflation sources must NOT appear.
    expect(sql).not.toContain('memory_facts');
    expect(sql).not.toContain('m.personality_id');
  });
});

describe('executeBackfill', () => {
  it('updates users from the same eligible SELECT and returns the row count', async () => {
    executeMock.mockResolvedValue(66);

    const updated = await executeBackfill({
      $queryRawUnsafe: queryMock,
      $executeRawUnsafe: executeMock,
    });

    expect(updated).toBe(66);
    const sql = executeMock.mock.calls[0][0] as string;
    expect(sql).toContain('UPDATE users u');
    expect(sql).toContain('SET last_active_at = eligible.last_active');
    // Same activity sources + guard as the analysis — the UPDATE must never widen.
    expect(sql).toContain('FROM usage_logs ul');
    expect(sql).toContain('u.last_active_at IS NULL OR latest.last_active > u.last_active_at');
  });
});

describe('backfillLastActive', () => {
  it('dry-run analyzes but never executes', async () => {
    queryMock.mockResolvedValue([{ bucket: 'a: <30d (active)', n: 3 }]);

    await backfillLastActive({ env: 'dev', dryRun: true });

    expect(queryMock).toHaveBeenCalledOnce();
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('executes the backfill when not a dry run', async () => {
    queryMock.mockResolvedValue([{ bucket: 'a: <30d (active)', n: 3 }]);
    executeMock.mockResolvedValue(3);

    await backfillLastActive({ env: 'dev' });

    expect(executeMock).toHaveBeenCalledOnce();
  });

  it('skips execution entirely when nothing is eligible', async () => {
    queryMock.mockResolvedValue([]);

    await backfillLastActive({ env: 'dev' });

    expect(executeMock).not.toHaveBeenCalled();
  });

  it('asks for production confirmation and honors a decline', async () => {
    confirmMock.mockResolvedValue(false);

    await backfillLastActive({ env: 'prod' });

    expect(confirmMock).toHaveBeenCalledOnce();
    expect(queryMock).not.toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('skips the confirmation on --force', async () => {
    queryMock.mockResolvedValue([{ bucket: 'a: <30d (active)', n: 1 }]);
    executeMock.mockResolvedValue(1);

    await backfillLastActive({ env: 'prod', force: true });

    expect(confirmMock).not.toHaveBeenCalled();
    expect(executeMock).toHaveBeenCalledOnce();
  });
});
