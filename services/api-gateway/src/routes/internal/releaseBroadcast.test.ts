/**
 * Tests for the internal release-broadcast delivery-ledger routes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

vi.mock('../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

const mockPrisma = {
  releaseDeliveryLog: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
  },
  releaseAnnouncement: {
    updateMany: vi.fn(),
    findUnique: vi.fn(),
  },
  user: {
    update: vi.fn(),
  },
};

import {
  handleReleaseBroadcastPending,
  handleReleaseBroadcastDeliveries,
} from './releaseBroadcast.js';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { RouteDeps } from '../routeDeps.js';

const RELEASE_ID = '123e4567-e89b-42d3-a456-426614174000';
const LOG_A = '223e4567-e89b-42d3-a456-426614174000';
const LOG_B = '323e4567-e89b-42d3-a456-426614174000';
const USER_A = '423e4567-e89b-42d3-a456-426614174000';

function makeDeps(): RouteDeps {
  return { prisma: mockPrisma as unknown as PrismaClient } as unknown as RouteDeps;
}

function createMockReqRes(body: Record<string, unknown>) {
  const req = { body, params: { releaseId: RELEASE_ID } } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

describe('POST /internal/release-broadcast/:releaseId/pending', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the still-pending subset', async () => {
    mockPrisma.releaseDeliveryLog.findMany.mockResolvedValueOnce([{ id: LOG_A }]);
    const handler = handleReleaseBroadcastPending(makeDeps());
    const { req, res } = createMockReqRes({ deliveryLogIds: [LOG_A, LOG_B] });

    await handler(req, res, vi.fn());

    expect(mockPrisma.releaseDeliveryLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { releaseId: RELEASE_ID, id: { in: [LOG_A, LOG_B] }, status: 'pending' },
      })
    );
    expect(res.json).toHaveBeenCalledWith({ pendingDeliveryLogIds: [LOG_A] });
  });

  it('rejects an empty id list with 400', async () => {
    const handler = handleReleaseBroadcastPending(makeDeps());
    const { req, res } = createMockReqRes({ deliveryLogIds: [] });

    await handler(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPrisma.releaseDeliveryLog.findMany).not.toHaveBeenCalled();
  });
});

describe('POST /internal/release-broadcast/:releaseId/deliveries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.releaseDeliveryLog.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.releaseDeliveryLog.count.mockResolvedValue(3);
    mockPrisma.releaseAnnouncement.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.releaseAnnouncement.findUnique.mockResolvedValue({ version: 'v-test' });
    mockPrisma.releaseDeliveryLog.groupBy.mockResolvedValue([
      { status: 'sent', errorCode: null, _count: { _all: 2 } },
      { status: 'failed_permanent', errorCode: '50007', _count: { _all: 1 } },
    ]);
  });

  it('transitions pending rows and reports the update count', async () => {
    const handler = handleReleaseBroadcastDeliveries(makeDeps());
    const { req, res } = createMockReqRes({
      results: [{ deliveryLogId: LOG_A, status: 'sent' }],
    });

    await handler(req, res, vi.fn());

    expect(mockPrisma.releaseDeliveryLog.updateMany).toHaveBeenCalledWith({
      where: { id: LOG_A, releaseId: RELEASE_ID, status: 'pending' },
      data: expect.objectContaining({ status: 'sent', errorCode: null }),
    });
    expect(res.json).toHaveBeenCalledWith({
      updated: 1,
      autoDisabledUserIds: [],
      completed: false,
    });
  });

  it('persists sentMessageId and stamps the deleted previous row', async () => {
    const PREV_LOG = '623e4567-e89b-42d3-a456-426614174000';
    const handler = handleReleaseBroadcastDeliveries(makeDeps());
    const { req, res } = createMockReqRes({
      results: [
        {
          deliveryLogId: LOG_A,
          status: 'sent',
          sentMessageId: 'sent-msg-1',
          deletedPreviousDeliveryLogId: PREV_LOG,
        },
      ],
    });

    await handler(req, res, vi.fn());

    // Stamp FIRST, main transition second — the stamp must not sit behind
    // the pending-only continue (see the retry test below).
    expect(mockPrisma.releaseDeliveryLog.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: PREV_LOG, messageDeletedAt: null },
      data: { messageDeletedAt: expect.any(Date) },
    });
    expect(mockPrisma.releaseDeliveryLog.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: LOG_A, releaseId: RELEASE_ID, status: 'pending' },
      data: expect.objectContaining({ status: 'sent', sentMessageId: 'sent-msg-1' }),
    });
  });

  it('still stamps the previous row when the main transition is a retry no-op', async () => {
    // Lost-response retry: the worker re-reports the same payload after the
    // first attempt committed the main transition but the response (or the
    // stamp write) was lost. The stamp is idempotent and independent — it
    // must run even though the main row is no longer pending.
    const PREV_LOG = '623e4567-e89b-42d3-a456-426614174000';
    mockPrisma.releaseDeliveryLog.updateMany
      .mockResolvedValueOnce({ count: 1 }) // the stamp write
      .mockResolvedValueOnce({ count: 0 }); // main transition: already terminal
    const handler = handleReleaseBroadcastDeliveries(makeDeps());
    const { req, res } = createMockReqRes({
      results: [
        {
          deliveryLogId: LOG_A,
          status: 'sent',
          sentMessageId: 'sent-msg-1',
          deletedPreviousDeliveryLogId: PREV_LOG,
        },
      ],
    });

    await handler(req, res, vi.fn());

    expect(mockPrisma.releaseDeliveryLog.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: PREV_LOG, messageDeletedAt: null },
      data: { messageDeletedAt: expect.any(Date) },
    });
    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      updated: number;
    };
    expect(payload.updated).toBe(0);
  });

  it('writes sentMessageId as null when the report omits it (failure rows)', async () => {
    const handler = handleReleaseBroadcastDeliveries(makeDeps());
    const { req, res } = createMockReqRes({
      results: [{ deliveryLogId: LOG_A, status: 'failed_transient', errorCode: 'ECONNRESET' }],
    });

    await handler(req, res, vi.fn());

    expect(mockPrisma.releaseDeliveryLog.updateMany).toHaveBeenCalledWith({
      where: { id: LOG_A, releaseId: RELEASE_ID, status: 'pending' },
      data: expect.objectContaining({ sentMessageId: null }),
    });
  });

  it('is idempotent: an already-terminal row does not count as updated', async () => {
    mockPrisma.releaseDeliveryLog.updateMany.mockResolvedValueOnce({ count: 0 });
    const handler = handleReleaseBroadcastDeliveries(makeDeps());
    const { req, res } = createMockReqRes({
      results: [{ deliveryLogId: LOG_A, status: 'sent' }],
    });

    await handler(req, res, vi.fn());

    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      updated: number;
    };
    expect(payload.updated).toBe(0);
  });

  it('auto-disables a user on the second consecutive permanent failure', async () => {
    mockPrisma.releaseDeliveryLog.findUnique.mockResolvedValueOnce({ userId: USER_A });
    mockPrisma.releaseDeliveryLog.findFirst.mockResolvedValueOnce({ status: 'failed_permanent' });
    const handler = handleReleaseBroadcastDeliveries(makeDeps());
    const { req, res } = createMockReqRes({
      results: [{ deliveryLogId: LOG_A, status: 'failed_permanent', errorCode: '50007' }],
    });

    await handler(req, res, vi.fn());

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: USER_A },
      data: { notifyEnabled: false },
    });
    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      autoDisabledUserIds: string[];
    };
    expect(payload.autoDisabledUserIds).toEqual([USER_A]);
  });

  it('does NOT auto-disable when the previous delivery was non-permanent (counter resets)', async () => {
    mockPrisma.releaseDeliveryLog.findUnique.mockResolvedValueOnce({ userId: USER_A });
    mockPrisma.releaseDeliveryLog.findFirst.mockResolvedValueOnce({ status: 'sent' });
    const handler = handleReleaseBroadcastDeliveries(makeDeps());
    const { req, res } = createMockReqRes({
      results: [{ deliveryLogId: LOG_A, status: 'failed_permanent', errorCode: '50007' }],
    });

    await handler(req, res, vi.fn());

    expect(mockPrisma.user.update).not.toHaveBeenCalled();
    // Seam assertion: the "previous delivery" scope is the user's most recent
    // terminal row across ALL releases, excluding the row being reported AND
    // resweep opted-out terminalizations (eligibility records, not delivery
    // events) — a refactor narrowing it to same-release-only must fail here.
    expect(mockPrisma.releaseDeliveryLog.findFirst).toHaveBeenCalledWith({
      where: {
        userId: USER_A,
        id: { not: LOG_A },
        status: { not: 'pending' },
        NOT: { errorCode: 'opted_out' },
      },
      orderBy: { updatedAt: 'desc' },
      select: { status: true },
    });
  });

  it('does NOT auto-disable when the previous delivery failed TRANSIENT (streak needs two permanents)', async () => {
    // Pins the interplay with historical misclassified rows: a failed_transient
    // row between two permanents resets the streak, so a user whose prior
    // failures were recorded transient needs two fresh permanent releases to
    // quiesce unless the old rows are flipped to failed_permanent.
    mockPrisma.releaseDeliveryLog.findUnique.mockResolvedValueOnce({ userId: USER_A });
    mockPrisma.releaseDeliveryLog.findFirst.mockResolvedValueOnce({ status: 'failed_transient' });
    const handler = handleReleaseBroadcastDeliveries(makeDeps());
    const { req, res } = createMockReqRes({
      results: [{ deliveryLogId: LOG_A, status: 'failed_permanent', errorCode: '50278' }],
    });

    await handler(req, res, vi.fn());

    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("does NOT auto-disable on a user's very first delivery failure (no history at all)", async () => {
    mockPrisma.releaseDeliveryLog.findUnique.mockResolvedValueOnce({ userId: USER_A });
    mockPrisma.releaseDeliveryLog.findFirst.mockResolvedValueOnce(null);
    const handler = handleReleaseBroadcastDeliveries(makeDeps());
    const { req, res } = createMockReqRes({
      results: [{ deliveryLogId: LOG_A, status: 'failed_permanent', errorCode: '50007' }],
    });

    await handler(req, res, vi.fn());

    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('stamps completedAt when no pending rows remain and carries the summary tally', async () => {
    mockPrisma.releaseDeliveryLog.count.mockResolvedValueOnce(0);
    const handler = handleReleaseBroadcastDeliveries(makeDeps());
    const { req, res } = createMockReqRes({
      results: [{ deliveryLogId: LOG_A, status: 'sent' }],
    });

    await handler(req, res, vi.fn());

    expect(mockPrisma.releaseAnnouncement.updateMany).toHaveBeenCalledWith({
      where: { id: RELEASE_ID, completedAt: null },
      data: { completedAt: expect.any(Date) },
    });
    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      completed: boolean;
      summary?: unknown;
    };
    expect(payload.completed).toBe(true);
    // Tallies come from the groupBy; missing statuses count zero.
    expect(payload.summary).toEqual({
      version: 'v-test',
      sent: 2,
      failedPermanent: 1,
      failedTransient: 0,
      optedOut: 0,
    });
  });

  it('splits resweep opted-out terminalizations out of the failedPermanent tally', async () => {
    mockPrisma.releaseDeliveryLog.count.mockResolvedValueOnce(0);
    mockPrisma.releaseDeliveryLog.groupBy.mockResolvedValueOnce([
      { status: 'sent', errorCode: null, _count: { _all: 3 } },
      { status: 'failed_permanent', errorCode: '50007', _count: { _all: 1 } },
      { status: 'failed_permanent', errorCode: 'opted_out', _count: { _all: 2 } },
    ]);
    const handler = handleReleaseBroadcastDeliveries(makeDeps());
    const { req, res } = createMockReqRes({
      results: [{ deliveryLogId: LOG_A, status: 'sent' }],
    });

    await handler(req, res, vi.fn());

    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      summary?: { failedPermanent: number; optedOut: number };
    };
    // failedPermanent must stay a pure delivery-health number — the two
    // administrative exclusions land in their own bucket.
    expect(payload.summary).toEqual({
      version: 'v-test',
      sent: 3,
      failedPermanent: 1,
      failedTransient: 0,
      optedOut: 2,
    });
  });

  it('auto-disable lookup ignores resweep opted-out rows (no send happened)', async () => {
    mockPrisma.releaseDeliveryLog.findUnique.mockResolvedValueOnce({ userId: USER_A });
    mockPrisma.releaseDeliveryLog.findFirst.mockResolvedValueOnce(null);
    const handler = handleReleaseBroadcastDeliveries(makeDeps());
    const { req, res } = createMockReqRes({
      results: [{ deliveryLogId: LOG_A, status: 'failed_permanent', errorCode: '50007' }],
    });

    await handler(req, res, vi.fn());

    // An opted_out terminalization is an eligibility record, not a delivery
    // event — it must never count toward the two-consecutive-failures streak
    // (it could silently undo a user's own re-enable).
    expect(mockPrisma.releaseDeliveryLog.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: USER_A,
          id: { not: LOG_A },
          status: { not: 'pending' },
          NOT: { errorCode: 'opted_out' },
        },
      })
    );
  });

  it('does NOT claim completion on a re-report that lost the flip race', async () => {
    // Zero pending rows, but completedAt was already stamped by an earlier
    // report (the lost-response retry case) — the flip updateMany matches 0.
    mockPrisma.releaseDeliveryLog.count.mockResolvedValueOnce(0);
    mockPrisma.releaseAnnouncement.updateMany.mockResolvedValueOnce({ count: 0 });
    const handler = handleReleaseBroadcastDeliveries(makeDeps());
    const { req, res } = createMockReqRes({
      results: [{ deliveryLogId: LOG_A, status: 'sent' }],
    });

    await handler(req, res, vi.fn());

    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      completed: boolean;
      summary?: unknown;
    };
    expect(payload.completed).toBe(false);
    expect(payload.summary).toBeUndefined();
    // No summary computation happens for the loser.
    expect(mockPrisma.releaseDeliveryLog.groupBy).not.toHaveBeenCalled();
  });

  it('rejects a pending status in the report body (schema)', async () => {
    const handler = handleReleaseBroadcastDeliveries(makeDeps());
    const { req, res } = createMockReqRes({
      results: [{ deliveryLogId: LOG_A, status: 'pending' }],
    });

    await handler(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPrisma.releaseDeliveryLog.updateMany).not.toHaveBeenCalled();
  });
});
