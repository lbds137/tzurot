import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import type { Queue } from 'bullmq';
import {
  handleRetentionNotify,
  handleRetentionNotifyFilter,
  handleRetentionNotifyReport,
} from './retentionNotify.js';
import type { RouteDeps } from '../routeDeps.js';

const enqueueMock = vi.hoisted(() => vi.fn());
const filterMock = vi.hoisted(() => vi.fn());
const reportMock = vi.hoisted(() => vi.fn());
vi.mock('../../services/retention/RetentionNotifyService.js', () => ({
  RetentionNotifyService: class {
    enqueueNotifyRun = enqueueMock;
    filterEligible = filterMock;
    reportOutcomes = reportMock;
  },
}));

const EMPTY_RUN = {
  status: 'empty',
  cohortSize: 0,
  userbaseCount: 100,
  percentOfUserbase: 0,
  breakerWarning: false,
  batchesEnqueued: 0,
  recipients: [],
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
  retentionNotifyQueue: {} as Queue,
} as RouteDeps;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleRetentionNotify', () => {
  it('passes the operator flags through and returns the run result', async () => {
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

  it('fails loudly when a REAL run has no queue — never a silent no-op', async () => {
    const { req, res } = createMockReqRes({});

    await handleRetentionNotify({ ...deps, retentionNotifyQueue: undefined } as RouteDeps)(
      req,
      res,
      vi.fn()
    );

    expect(res.status).toHaveBeenCalledWith(500);
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
});

describe('handleRetentionNotifyFilter', () => {
  it('returns the still-eligible subset', async () => {
    filterMock.mockResolvedValue(['a3bb189e-8bf9-3888-9912-ace4e6543002']);
    const { req, res } = createMockReqRes({
      userIds: ['a3bb189e-8bf9-3888-9912-ace4e6543002', 'b3bb189e-8bf9-3888-9912-ace4e6543002'],
    });

    await handleRetentionNotifyFilter(deps)(req, res, vi.fn());

    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.stillEligibleUserIds).toEqual(['a3bb189e-8bf9-3888-9912-ace4e6543002']);
  });

  it('rejects an empty batch', async () => {
    const { req, res } = createMockReqRes({ userIds: [] });

    await handleRetentionNotifyFilter(deps)(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(filterMock).not.toHaveBeenCalled();
  });
});

describe('handleRetentionNotifyReport', () => {
  it('applies outcomes and reports the processed count', async () => {
    reportMock.mockResolvedValue(1);
    const outcomes = [{ userId: 'a3bb189e-8bf9-3888-9912-ace4e6543002', status: 'sent' }];
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
