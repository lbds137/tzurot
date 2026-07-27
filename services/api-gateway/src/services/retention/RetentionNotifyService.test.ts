import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Queue } from 'bullmq';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { RetentionNotifyService } from './RetentionNotifyService.js';

const mockAllowlist = vi.hoisted(() => vi.fn());
vi.mock('@tzurot/common-types/utils/outboundDmAllowlist', () => ({
  getOutboundDmAllowlist: mockAllowlist,
}));

const mockAddValidatedJob = vi.hoisted(() => vi.fn());
vi.mock('../../utils/validatedQueue.js', () => ({ addValidatedJob: mockAddValidatedJob }));

const NOW = (): Date => new Date('2026-07-26T12:00:00.000Z');

function cohortRow(n: number) {
  return {
    userId: `c0407000-0000-4000-8000-1000000000${String(n).padStart(2, '0')}`,
    discordId: `90000000000000${String(n).padStart(4, '0')}`,
    inactiveSince: new Date('2025-01-01T00:00:00Z'),
  };
}

function makePrisma(opts: { cohort: unknown[]; userbase: number }) {
  return {
    // call 1 = selectNotifyCohort; later calls = report stamps / filter
    $queryRaw: vi.fn().mockResolvedValue(opts.cohort),
    $executeRaw: vi.fn().mockResolvedValue(1),
    user: { count: vi.fn().mockResolvedValue(opts.userbase) },
  } as unknown as PrismaClient;
}

const queue = {} as Queue;

beforeEach(() => {
  vi.clearAllMocks();
  mockAllowlist.mockReturnValue(null);
  mockAddValidatedJob.mockResolvedValue(undefined);
});

describe('RetentionNotifyService.enqueueNotifyRun', () => {
  it('reports empty as the healthy steady state without enqueuing', async () => {
    const service = new RetentionNotifyService(makePrisma({ cohort: [], userbase: 100 }));

    const result = await service.enqueueNotifyRun(queue, { now: NOW });

    expect(result.status).toBe('empty');
    expect(result.batchesEnqueued).toBe(0);
    expect(mockAddValidatedJob).not.toHaveBeenCalled();
  });

  it('enqueues 50-recipient batches with per-invocation-unique jobIds', async () => {
    const cohort = Array.from({ length: 51 }, (_, i) => cohortRow(i));
    const service = new RetentionNotifyService(makePrisma({ cohort, userbase: 1000 }));

    const result = await service.enqueueNotifyRun(queue, { now: NOW, runContext: 'first-run' });

    expect(result.status).toBe('enqueued');
    expect(result.batchesEnqueued).toBe(2);
    expect(mockAddValidatedJob).toHaveBeenCalledTimes(2);
    // The seam assertion: batch 0 carries 50 recipients, batch 1 the remainder,
    // and the jobId embeds the timestamped runId (cross-run collisions would
    // silently swallow a later run's batch behind BullMQ's dedup).
    const [, , payload0, opts0] = mockAddValidatedJob.mock.calls[0];
    const [, , payload1] = mockAddValidatedJob.mock.calls[1];
    expect(payload0.recipients).toHaveLength(50);
    expect(payload1.recipients).toHaveLength(1);
    expect(payload0.recipients[0]).toEqual({
      userId: cohort[0].userId,
      discordUserId: cohort[0].discordId,
    });
    // Colon-free by contract: BullMQ rejects colon-bearing custom ids, and the
    // mocked queue can't catch that — pin the sanitized shape explicitly.
    expect(opts0.jobId).toBe('retention-notify-2026-07-26T12-00-00.000Z-first-run-0');
    expect(opts0.jobId).not.toContain(':');
  });

  it('sanitizes colons out of an operator-supplied runContext', async () => {
    const cohort = [cohortRow(0)];
    const service = new RetentionNotifyService(makePrisma({ cohort, userbase: 1000 }));

    await service.enqueueNotifyRun(queue, { now: NOW, runContext: 'retry: batch 2' });

    const [, , , opts] = mockAddValidatedJob.mock.calls[0];
    expect(opts.jobId).toBe('retention-notify-2026-07-26T12-00-00.000Z-retry- batch 2-0');
    expect(opts.jobId).not.toContain(':');
  });

  it('warn-annotates without refusing between the warn and hard fractions', async () => {
    // 51 of 273 ≈ 18.7% — the expected first-real-run shape (zombie cohort).
    const cohort = Array.from({ length: 51 }, (_, i) => cohortRow(i));
    const service = new RetentionNotifyService(makePrisma({ cohort, userbase: 273 }));

    const result = await service.enqueueNotifyRun(queue, { now: NOW });

    expect(result.status).toBe('enqueued');
    expect(result.breakerWarning).toBe(true);
    expect(result.percentOfUserbase).toBe(18.7);
  });

  it('refuses over the hard ceiling without breakerOverride — and enqueues nothing', async () => {
    const cohort = Array.from({ length: 30 }, (_, i) => cohortRow(i));
    const service = new RetentionNotifyService(makePrisma({ cohort, userbase: 100 }));

    const result = await service.enqueueNotifyRun(queue, { now: NOW });

    expect(result.status).toBe('refused_breaker');
    expect(result.breakerDetail).toContain('hard ceiling');
    expect(mockAddValidatedJob).not.toHaveBeenCalled();
  });

  it('proceeds past the ceiling with an explicit breakerOverride', async () => {
    const cohort = Array.from({ length: 30 }, (_, i) => cohortRow(i));
    const service = new RetentionNotifyService(makePrisma({ cohort, userbase: 100 }));

    const result = await service.enqueueNotifyRun(queue, { now: NOW, breakerOverride: true });

    expect(result.status).toBe('enqueued');
  });

  it('dry-run reports the full cohort and enqueues nothing', async () => {
    const cohort = [cohortRow(1), cohortRow(2)];
    const service = new RetentionNotifyService(makePrisma({ cohort, userbase: 100 }));

    const result = await service.enqueueNotifyRun(queue, { now: NOW, dryRun: true });

    expect(result.status).toBe('dry_run');
    expect(result.recipients).toHaveLength(2);
    expect(mockAddValidatedJob).not.toHaveBeenCalled();
  });
});

describe('RetentionNotifyService.reportOutcomes', () => {
  const USER = 'c0407000-0000-4000-8000-100000000001';

  function makeReportPrisma() {
    const executeRaw = vi.fn().mockResolvedValue(1);
    return {
      prisma: { $executeRaw: executeRaw } as unknown as PrismaClient,
      executeRaw,
    };
  }

  it('stamps the grace clock on sent, IS NULL-guarded', async () => {
    const { prisma, executeRaw } = makeReportPrisma();

    const processed = await new RetentionNotifyService(prisma).reportOutcomes([
      { userId: USER, status: 'sent' },
    ]);

    expect(processed).toBe(1);
    const [strings] = executeRaw.mock.calls[0] as [TemplateStringsArray];
    const text = strings.join('');
    expect(text).toContain('retention_notified_at = NOW()');
    expect(text).toContain('retention_notified_at IS NULL');
    expect(text).not.toContain('updated_at');
  });

  it('routes a 50278 bounce to the unreachable stamp (the re-route arm)', async () => {
    const { prisma, executeRaw } = makeReportPrisma();

    await new RetentionNotifyService(prisma).reportOutcomes([
      { userId: USER, status: 'failed_permanent', errorCode: '50278' },
    ]);

    const [strings] = executeRaw.mock.calls[0] as [TemplateStringsArray];
    expect(strings.join('')).toContain('dm_undeliverable_since = NOW()');
  });

  it('stamps nothing for bot-level and transient outcomes', async () => {
    const { prisma, executeRaw } = makeReportPrisma();

    const processed = await new RetentionNotifyService(prisma).reportOutcomes([
      { userId: USER, status: 'failed_bot_level', errorCode: '20026' },
      { userId: USER, status: 'failed_transient' },
    ]);

    expect(processed).toBe(0);
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('propagates stamp failures so the worker report retries', async () => {
    const { prisma, executeRaw } = makeReportPrisma();
    executeRaw.mockRejectedValueOnce(new Error('db down'));

    await expect(
      new RetentionNotifyService(prisma).reportOutcomes([{ userId: USER, status: 'sent' }])
    ).rejects.toThrow('db down');
  });
});
