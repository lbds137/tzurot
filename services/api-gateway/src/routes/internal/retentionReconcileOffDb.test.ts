import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { RetentionReconcileOffDbResponseSchema } from '@tzurot/common-types/schemas/api/internal';

const reconcileMock = vi.hoisted(() => vi.fn());

vi.mock('../../utils/asyncHandler.js', () => ({ asyncHandler: vi.fn(fn => fn) }));
vi.mock('../../services/retention/RetentionPurgeService.js', () => ({
  // Plain function: constructable (arrows are not).
  RetentionPurgeService: function MockRetentionPurgeService() {
    return { reconcileOffDb: reconcileMock };
  },
}));

import { handleRetentionReconcileOffDb } from './retentionReconcileOffDb.js';
import type { RouteDeps } from '../routeDeps.js';

function createMockReqRes() {
  const req = {} as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

describe('POST /internal/retention/reconcile-off-db', () => {
  it('returns the sweep tally in the manifest-declared shape', async () => {
    reconcileMock.mockResolvedValue({ settled: 3, stillFailing: 1, remaining: 0 });
    const { req, res } = createMockReqRes();

    await handleRetentionReconcileOffDb({} as RouteDeps)(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload).toEqual({ settled: 3, stillFailing: 1, remaining: 0 });
    expect(RetentionReconcileOffDbResponseSchema.safeParse(payload).success).toBe(true);
  });

  it('is a 200 no-op on an empty ledger — the purge CLI calls it every run', async () => {
    reconcileMock.mockResolvedValue({ settled: 0, stillFailing: 0, remaining: 0 });
    const { req, res } = createMockReqRes();

    await handleRetentionReconcileOffDb({} as RouteDeps)(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual({
      settled: 0,
      stillFailing: 0,
      remaining: 0,
    });
  });
});
