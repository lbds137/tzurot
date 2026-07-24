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
  // Retention undeliverable stamp writes via raw SQL (keeps updated_at off the
  // sync LWW resolver). Default resolves so the happy path needs no per-test setup.
  $executeRaw: vi.fn().mockResolvedValue(1),
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

/** True if any $executeRaw call's SQL skeleton contains `substr`. */
function executeRawSqlIncludes(substr: string): boolean {
  return (mockPrisma.$executeRaw as ReturnType<typeof vi.fn>).mock.calls.some(call =>
    (call[0] as TemplateStringsArray).join(' ').includes(substr)
  );
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
      // notifyAutoDisabledAt marks the infrastructure disable — the flag the
      // deliberate-use lift keys on; without it a re-engaged user could never
      // be distinguished from an explicit opt-out.
      data: { notifyEnabled: false, notifyAutoDisabledAt: expect.any(Date) },
    });
    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      autoDisabledUserIds: string[];
    };
    expect(payload.autoDisabledUserIds).toEqual([USER_A]);
  });

  it('stamps discord_account_gone_at (NOT dm_undeliverable_since) on a 10013 deleted-account failure', async () => {
    mockPrisma.releaseDeliveryLog.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.releaseDeliveryLog.count.mockResolvedValue(1); // pending remains → no completion flip
    mockPrisma.releaseDeliveryLog.findUnique.mockResolvedValueOnce({ userId: USER_A });
    mockPrisma.releaseDeliveryLog.findFirst.mockResolvedValueOnce({ status: 'sent' }); // no auto-disable
    const handler = handleReleaseBroadcastDeliveries(makeDeps());
    const { req, res } = createMockReqRes({
      results: [{ deliveryLogId: LOG_A, status: 'failed_permanent', errorCode: '10013' }],
    });

    await handler(req, res, vi.fn());

    // 10013 = deleted account → the DISTINCT gone-account stamp (its own
    // first-failure guard), not the 50278/50007 unreachable stamp.
    expect(executeRawSqlIncludes('discord_account_gone_at = NOW()')).toBe(true);
    expect(executeRawSqlIncludes('dm_undeliverable_since = NOW()')).toBe(false);
  });

  it('clears dm_undeliverable_since for the sent set (blast-success clear)', async () => {
    mockPrisma.releaseDeliveryLog.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.releaseDeliveryLog.count.mockResolvedValue(1); // pending remains → no completion flip
    const handler = handleReleaseBroadcastDeliveries(makeDeps());
    const { req, res } = createMockReqRes({
      results: [{ deliveryLogId: LOG_A, status: 'sent', sentMessageId: 'm-1' }],
    });

    await handler(req, res, vi.fn());

    // A reached-again user (rejoined a server so THIS blast landed but never
    // otherwise interacted) gets their stale unreachable flag cleared, batched
    // over the sent set — otherwise the purge branch would route them to
    // unreachable-purge-without-notice.
    expect(executeRawSqlIncludes('dm_undeliverable_since = NULL')).toBe(true);
  });

  it('swallows a failed blast-success clear without failing the batch', async () => {
    mockPrisma.releaseDeliveryLog.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.releaseDeliveryLog.count.mockResolvedValue(1); // pending remains → no completion flip
    // The clear is best-effort: delivery rows are already committed, so a raw-SQL
    // failure must not 500 the batch. A sent-only result routes $executeRaw solely
    // to the clear, so this rejection exercises exactly its catch — the batch must
    // still report its success payload.
    mockPrisma.$executeRaw.mockRejectedValueOnce(new Error('db unavailable'));
    const handler = handleReleaseBroadcastDeliveries(makeDeps());
    const { req, res } = createMockReqRes({
      results: [{ deliveryLogId: LOG_A, status: 'sent', sentMessageId: 'm-1' }],
    });

    await handler(req, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith({
      updated: 1,
      autoDisabledUserIds: [],
      completed: false,
    });
  });

  it('stamps NO retention signal on an unrecognized permanent-failure code', async () => {
    mockPrisma.releaseDeliveryLog.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.releaseDeliveryLog.count.mockResolvedValue(1);
    mockPrisma.releaseDeliveryLog.findUnique.mockResolvedValueOnce({ userId: USER_A });
    mockPrisma.releaseDeliveryLog.findFirst.mockResolvedValueOnce(null);
    const handler = handleReleaseBroadcastDeliveries(makeDeps());
    const { req, res } = createMockReqRes({
      // Neither a per-user unreachable code (50278/50007) nor deleted-account
      // (10013) → stamps nothing. Guards the if/else-if from silently growing a
      // branch that stamps unconditionally (a wrong stamp = wrong purge later).
      results: [{ deliveryLogId: LOG_A, status: 'failed_permanent', errorCode: '99999' }],
    });

    await handler(req, res, vi.fn());

    expect(executeRawSqlIncludes('dm_undeliverable_since = NOW()')).toBe(false);
    expect(executeRawSqlIncludes('discord_account_gone_at = NOW()')).toBe(false);
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

  it('stamps dm_undeliverable_since (first-failure guard) on a 50278 permanent failure', async () => {
    mockPrisma.releaseDeliveryLog.findUnique.mockResolvedValueOnce({ userId: USER_A });
    mockPrisma.releaseDeliveryLog.findFirst.mockResolvedValueOnce(null); // no auto-disable
    const handler = handleReleaseBroadcastDeliveries(makeDeps());
    const { req, res } = createMockReqRes({
      results: [{ deliveryLogId: LOG_A, status: 'failed_permanent', errorCode: '50278' }],
    });

    await handler(req, res, vi.fn());

    // The undeliverable clock starts via a raw UPDATE keyed by the user id, with
    // a `dm_undeliverable_since IS NULL` guard so only the FIRST failure records
    // (never advancing a live streak) and updated_at stays untouched.
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
    const [template, userId] = mockPrisma.$executeRaw.mock.calls[0] as [string[], string];
    expect(template.join('')).toContain('dm_undeliverable_since');
    expect(template.join('')).toContain('IS NULL');
    expect(template.join('')).not.toContain('updated_at');
    expect(userId).toBe(USER_A);
  });

  it('stamps dm_undeliverable_since on a 50007 permanent failure', async () => {
    mockPrisma.releaseDeliveryLog.findUnique.mockResolvedValueOnce({ userId: USER_A });
    mockPrisma.releaseDeliveryLog.findFirst.mockResolvedValueOnce(null);
    const handler = handleReleaseBroadcastDeliveries(makeDeps());
    const { req, res } = createMockReqRes({
      results: [{ deliveryLogId: LOG_A, status: 'failed_permanent', errorCode: '50007' }],
    });

    await handler(req, res, vi.fn());

    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
    const [template] = mockPrisma.$executeRaw.mock.calls[0] as [string[], string];
    expect(template.join('')).toContain('dm_undeliverable_since');
  });

  it('swallows an undeliverable-stamp failure and keeps processing the rest of the batch', async () => {
    // The row's terminal transition already committed before the stamp runs, so
    // a thrown stamp must NOT 500 the batch — that would strand this row on
    // retry (its pending guard already flipped) AND skip every later row. The
    // side-effects are best-effort; swallow + continue.
    mockPrisma.releaseDeliveryLog.findUnique.mockResolvedValueOnce({ userId: USER_A });
    mockPrisma.$executeRaw.mockRejectedValueOnce(new Error('db blip'));
    const handler = handleReleaseBroadcastDeliveries(makeDeps());
    const { req, res } = createMockReqRes({
      results: [
        { deliveryLogId: LOG_A, status: 'failed_permanent', errorCode: '50278' },
        { deliveryLogId: LOG_B, status: 'sent' },
      ],
    });

    // No throw propagates (pre-fix this rejected); both rows transition — the
    // later, unrelated row must still be processed.
    await handler(req, res, vi.fn());

    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as { updated: number };
    expect(payload.updated).toBe(2);
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
      failedBotLevel: 0,
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
      failedBotLevel: 0,
      optedOut: 2,
    });
  });

  it('counts failed_bot_level rows in their own bucket, not permanent or transient', async () => {
    mockPrisma.releaseDeliveryLog.count.mockResolvedValueOnce(0);
    mockPrisma.releaseDeliveryLog.groupBy.mockResolvedValueOnce([
      { status: 'sent', errorCode: null, _count: { _all: 1 } },
      { status: 'failed_bot_level', errorCode: '20026', _count: { _all: 5 } },
    ]);
    const handler = handleReleaseBroadcastDeliveries(makeDeps());
    const { req, res } = createMockReqRes({
      results: [{ deliveryLogId: LOG_A, status: 'sent' }],
    });

    await handler(req, res, vi.fn());

    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      summary?: unknown;
    };
    // The bot-quarantine rows are reachable users — kept out of both failure
    // buckets so neither number reads as recipient ill-health.
    expect(payload.summary).toEqual({
      version: 'v-test',
      sent: 1,
      failedPermanent: 0,
      failedTransient: 0,
      failedBotLevel: 5,
      optedOut: 0,
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
