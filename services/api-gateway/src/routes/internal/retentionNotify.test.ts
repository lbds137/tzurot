import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import type { Queue } from 'bullmq';
import { RunLeaseUnavailableError } from '../../services/retention/runLease.js';
import type { RouteDeps } from '../routeDeps.js';

const enqueueMock = vi.hoisted(() => vi.fn());
const filterMock = vi.hoisted(() => vi.fn());
const reportMock = vi.hoisted(() => vi.fn());
const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));

vi.mock('../../services/retention/RetentionNotifyService.js', () => ({
  RetentionNotifyService: class {
    enqueueNotifyRun = enqueueMock;
    filterEligible = filterMock;
    reportOutcomes = reportMock;
  },
}));
// The REAL guard runs (refreshRunLeaseOrRespond); only the RunLease class
// underneath is replaced.
vi.mock('../../services/retention/runLease.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../services/retention/runLease.js')>();
  return {
    RUN_LEASE_KEY: actual.RUN_LEASE_KEY,
    RUN_LEASE_TTL_MS: actual.RUN_LEASE_TTL_MS,
    RunLeaseUnavailableError: actual.RunLeaseUnavailableError,
    RunLease: class {
      refresh = refreshMock;
    },
  };
});

import {
  handleRetentionNotify,
  handleRetentionNotifyFilter,
  handleRetentionNotifyReport,
} from './retentionNotify.js';
import { UNLABELLED_RUN } from './retentionRun.js';

const RUN_ID = '3f2b8c1e-9d4a-4c5b-8e7f-1a2b3c4d5e6f';

const EMPTY_RUN = {
  status: 'empty',
  cohortSize: 0,
  userbaseCount: 100,
  percentOfUserbase: 0,
  breakerWarning: false,
  batchesEnqueued: 0,
  recipients: [],
  reminderCohortSize: 0,
  reminderBatchesEnqueued: 0,
  reminderRecipients: [],
};

function createMockReqRes(body: unknown) {
  const req = { body } as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

const deps = {
  prisma: {},
  redis: {},
  retentionNotifyQueue: {} as Queue,
} as RouteDeps;

beforeEach(() => {
  vi.clearAllMocks();
  refreshMock.mockResolvedValue({ ok: true });
});

describe('handleRetentionNotify', () => {
  it('a dry run passes the operator flags through and returns the run result', async () => {
    enqueueMock.mockResolvedValue(EMPTY_RUN);
    const { req, res } = createMockReqRes({ dryRun: true, runContext: 'test-run' });

    await handleRetentionNotify(deps)(req, res, vi.fn());

    expect(enqueueMock).toHaveBeenCalledWith(deps.retentionNotifyQueue, {
      dryRun: true,
      runContext: 'test-run',
    });
    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.status).toBe('empty');
  });

  it('a dry run never touches the run lease and needs no runId', async () => {
    enqueueMock.mockResolvedValue(EMPTY_RUN);
    const { req, res } = createMockReqRes({ dryRun: true });

    await handleRetentionNotify(deps)(req, res, vi.fn());

    expect(refreshMock).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(400);
  });

  it('fails loudly when a REAL run has no queue — never a silent no-op', async () => {
    // The lease refresh runs first (see the reorder below), so a held lease
    // is the setup here — this test pins the queue-missing 500, not the
    // lease check, which has its own tests further down.
    const { req, res } = createMockReqRes({ runId: RUN_ID });

    await handleRetentionNotify({ ...deps, retentionNotifyQueue: undefined } as RouteDeps)(
      req,
      res,
      vi.fn()
    );

    expect(res.status).toHaveBeenCalledWith(500);
    expect(enqueueMock).not.toHaveBeenCalled();
    // The lease refresh precedes the queue check — a call that held its
    // lease still hits the queue-missing 500, not a silent no-op.
    expect(refreshMock).toHaveBeenCalled();
  });

  it('a lease lost on the non-dry path answers 409 even when the queue is also missing — never a 500', async () => {
    // The lease refresh runs BEFORE the queue check, so a lost lease must
    // short-circuit before the queue-missing branch is ever reached.
    refreshMock.mockResolvedValue({
      ok: false,
      holder: { runContext: 'other run', acquiredAt: '2026-01-01T00:00:00.000Z' },
    });
    const { req, res } = createMockReqRes({ runId: RUN_ID });

    await handleRetentionNotify({ ...deps, retentionNotifyQueue: undefined } as RouteDeps)(
      req,
      res,
      vi.fn()
    );

    expect(res.status).toHaveBeenCalledWith(409);
    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.code).toBe('RUN_LEASE_CONFLICT');
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('lets a dry run proceed without a queue (it never enqueues)', async () => {
    enqueueMock.mockResolvedValue(EMPTY_RUN);
    const { req, res } = createMockReqRes({ dryRun: true });

    await handleRetentionNotify({ ...deps, retentionNotifyQueue: undefined } as RouteDeps)(
      req,
      res,
      vi.fn()
    );

    expect(enqueueMock).toHaveBeenCalledWith(null, { dryRun: true });
  });

  it('rejects a malformed body', async () => {
    const { req, res } = createMockReqRes({ dryRun: 'yes' });

    await handleRetentionNotify(deps)(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects a non-dry body with no runId — the service is never called', async () => {
    const { req, res } = createMockReqRes({});

    await handleRetentionNotify(deps)(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('a non-dry run refreshes the lease with (runId, runContext) BEFORE enqueueing, and forwards NO runId to the service', async () => {
    enqueueMock.mockResolvedValue({ ...EMPTY_RUN, status: 'enqueued', batchesEnqueued: 1 });
    const { req, res } = createMockReqRes({
      runContext: 'ops retention:notify (prod)',
      breakerOverride: true,
      runId: RUN_ID,
    });

    await handleRetentionNotify(deps)(req, res, vi.fn());

    expect(refreshMock).toHaveBeenCalledWith(RUN_ID, 'ops retention:notify (prod)');
    expect(refreshMock.mock.invocationCallOrder[0]).toBeLessThan(
      enqueueMock.mock.invocationCallOrder[0]
    );

    const optionsArg = enqueueMock.mock.calls[0][1] as Record<string, unknown>;
    expect(optionsArg).toEqual({
      breakerOverride: true,
      runContext: 'ops retention:notify (prod)',
      dryRun: false,
    });
    expect(optionsArg).not.toHaveProperty('runId');
  });

  it('refreshes with UNLABELLED_RUN when a non-dry body carries no runContext', async () => {
    enqueueMock.mockResolvedValue(EMPTY_RUN);
    const { req, res } = createMockReqRes({ runId: RUN_ID });

    await handleRetentionNotify(deps)(req, res, vi.fn());

    expect(refreshMock).toHaveBeenCalledWith(RUN_ID, UNLABELLED_RUN);
  });

  it('a lease conflict on the non-dry path answers 409 and never enqueues', async () => {
    refreshMock.mockResolvedValue({
      ok: false,
      holder: { runContext: 'other run', acquiredAt: '2026-01-01T00:00:00.000Z' },
    });
    const { req, res } = createMockReqRes({ runId: RUN_ID });

    await handleRetentionNotify(deps)(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('an unavailable lease store answers 503 and never enqueues', async () => {
    refreshMock.mockRejectedValue(new RunLeaseUnavailableError(new Error('store down')));
    const { req, res } = createMockReqRes({ runId: RUN_ID });

    await handleRetentionNotify(deps)(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(503);
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});

describe('handleRetentionNotifyFilter', () => {
  it('returns the still-eligible subset', async () => {
    filterMock.mockResolvedValue(['a3bb189e-8bf9-3888-9912-ace4e6543002']);
    const { req, res } = createMockReqRes({
      userIds: ['a3bb189e-8bf9-3888-9912-ace4e6543002', 'b3bb189e-8bf9-3888-9912-ace4e6543002'],
      notice: 'warning',
    });

    await handleRetentionNotifyFilter(deps)(req, res, vi.fn());

    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.stillEligibleUserIds).toEqual(['a3bb189e-8bf9-3888-9912-ace4e6543002']);
  });

  it('passes the notice kind through to the service', async () => {
    filterMock.mockResolvedValue([]);
    const { req, res } = createMockReqRes({
      userIds: ['a3bb189e-8bf9-3888-9912-ace4e6543002'],
      notice: 'reminder',
    });

    await handleRetentionNotifyFilter(deps)(req, res, vi.fn());

    expect(filterMock).toHaveBeenCalledWith(['a3bb189e-8bf9-3888-9912-ace4e6543002'], 'reminder');
  });

  it('rejects an empty batch', async () => {
    const { req, res } = createMockReqRes({ userIds: [], notice: 'warning' });

    await handleRetentionNotifyFilter(deps)(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(filterMock).not.toHaveBeenCalled();
  });
});

describe('handleRetentionNotifyReport', () => {
  it('applies outcomes and reports the processed count', async () => {
    reportMock.mockResolvedValue(1);
    const outcomes = [
      { userId: 'a3bb189e-8bf9-3888-9912-ace4e6543002', status: 'sent', notice: 'warning' },
    ];
    const { req, res } = createMockReqRes({ outcomes });

    await handleRetentionNotifyReport(deps)(req, res, vi.fn());

    expect(reportMock).toHaveBeenCalledWith(outcomes);
    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.processed).toBe(1);
  });

  it('rejects an outcome with an unknown status', async () => {
    const { req, res } = createMockReqRes({
      outcomes: [{ userId: 'a3bb189e-8bf9-3888-9912-ace4e6543002', status: 'maybe' }],
    });

    await handleRetentionNotifyReport(deps)(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
