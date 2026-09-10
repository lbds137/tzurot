import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { RetentionPurgeResponseSchema } from '@tzurot/common-types/schemas/api/internal';

const purgeUserMock = vi.hoisted(() => vi.fn());
const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));

vi.mock('../../utils/asyncHandler.js', () => ({ asyncHandler: vi.fn(fn => fn) }));
vi.mock('../../services/retention/RetentionPurgeService.js', () => ({
  // Plain function: constructable (arrows are not).
  RetentionPurgeService: function MockRetentionPurgeService() {
    return { purgeUser: purgeUserMock };
  },
}));
// The REAL guard runs (refreshRunLeaseOrRespond); only the RunLease class
// underneath is replaced, so the lease-conflict / lease-unavailable paths
// exercise the actual route logic, not a stubbed guard.
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

import { handleRetentionPurge } from './retentionPurge.js';
import { SuperuserDeletionError } from '../../services/AccountDeletionService.js';
import { RunLeaseUnavailableError } from '../../services/retention/runLease.js';
import { UNLABELLED_RUN } from './retentionRun.js';
import type { RouteDeps } from '../routeDeps.js';

const RUN_ID = '3f2b8c1e-9d4a-4c5b-8e7f-1a2b3c4d5e6f';
const deps = { redis: {} } as unknown as RouteDeps;

function createMockReqRes(body: unknown) {
  const req = { body } as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

function payloadOf(res: Response): Record<string, unknown> {
  return (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
}

describe('POST /api/internal/retention/purge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refreshMock.mockResolvedValue({ ok: true });
  });

  it('forwards the target, run context, and override across the seam', async () => {
    purgeUserMock.mockResolvedValue({
      status: 'purged',
      discordId: '900000000000000001',
      charactersDeleted: 2,
      charactersReHomed: 1,
    });
    const { req, res } = createMockReqRes({
      discordId: '900000000000000001',
      runContext: 'ops retention:purge (prod)',
      breakerOverride: true,
      runId: RUN_ID,
    });

    await handleRetentionPurge(deps)(req, res, vi.fn());

    // The breaker override in particular MUST cross intact: silently dropping
    // it would make an operator's explicit override a no-op, and silently
    // inventing it would defeat the ceiling entirely.
    expect(purgeUserMock).toHaveBeenCalledWith({
      discordId: '900000000000000001',
      runContext: 'ops retention:purge (prod)',
      breakerOverride: true,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(RetentionPurgeResponseSchema.safeParse(payloadOf(res)).success).toBe(true);
  });

  it('defaults a missing run context to null rather than undefined', async () => {
    purgeUserMock.mockResolvedValue({
      status: 'skipped',
      discordId: '900000000000000001',
      reason: 'already_gone',
    });
    const { req, res } = createMockReqRes({ discordId: '900000000000000001', runId: RUN_ID });

    await handleRetentionPurge(deps)(req, res, vi.fn());

    expect(purgeUserMock).toHaveBeenCalledWith({
      discordId: '900000000000000001',
      runContext: null,
      breakerOverride: undefined,
    });
  });

  it('returns 200 for an already-gone target — the loop must be re-runnable', async () => {
    purgeUserMock.mockResolvedValue({
      status: 'skipped',
      discordId: '900000000000000001',
      reason: 'already_gone',
    });
    const { req, res } = createMockReqRes({ discordId: '900000000000000001', runId: RUN_ID });

    await handleRetentionPurge(deps)(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(payloadOf(res)).toMatchObject({ status: 'skipped', reason: 'already_gone' });
  });

  it('returns 200 with the breaker detail when the ceiling trips', async () => {
    purgeUserMock.mockResolvedValue({
      status: 'skipped',
      discordId: '900000000000000001',
      reason: 'breaker_tripped',
      detail: 'Circuit breaker: 30 of 100 users (30%) are purge-eligible.',
    });
    const { req, res } = createMockReqRes({ discordId: '900000000000000001', runId: RUN_ID });

    await handleRetentionPurge(deps)(req, res, vi.fn());

    const payload = payloadOf(res);
    expect(payload).toMatchObject({ reason: 'breaker_tripped' });
    expect(payload.detail).toContain('Circuit breaker');
    expect(RetentionPurgeResponseSchema.safeParse(payload).success).toBe(true);
  });

  it('accepts a malformed stored id — the id is a lookup key, not a trust boundary', async () => {
    // A legacy prod row holds the literal 'unknown'; the preview surfaces it
    // and the operator must be able to purge it. Safety lives in the
    // parameterized SQL + the in-tx eligibility re-check; a nonexistent id
    // just skips as already_gone.
    purgeUserMock.mockResolvedValue({
      status: 'skipped',
      discordId: 'unknown',
      reason: 'already_gone',
    });
    const { req, res } = createMockReqRes({ discordId: 'unknown', runId: RUN_ID });

    await handleRetentionPurge(deps)(req, res, vi.fn());

    expect(purgeUserMock).toHaveBeenCalledWith(expect.objectContaining({ discordId: 'unknown' }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('still rejects an empty-string id without touching the service', async () => {
    const { req, res } = createMockReqRes({ discordId: '', runId: RUN_ID });

    await handleRetentionPurge(deps)(req, res, vi.fn());

    expect(purgeUserMock).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(200);
  });

  it('maps a superuser target to 403 rather than swallowing it as a skip', async () => {
    // The predicate excludes superusers, so this can only mean the predicate
    // and the erasure backstop disagree — worth surfacing, not normalising.
    purgeUserMock.mockRejectedValue(new SuperuserDeletionError());
    const { req, res } = createMockReqRes({ discordId: '900000000000000001', runId: RUN_ID });

    await handleRetentionPurge(deps)(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('propagates any other error to the error handler', async () => {
    purgeUserMock.mockRejectedValue(new Error('database exploded'));
    const { req, res } = createMockReqRes({ discordId: '900000000000000001', runId: RUN_ID });

    await expect(handleRetentionPurge(deps)(req, res, vi.fn())).rejects.toThrow(
      'database exploded'
    );
  });

  it('rejects a body with no runId, never calling purgeUser', async () => {
    const { req, res } = createMockReqRes({ discordId: '900000000000000001' });

    await handleRetentionPurge(deps)(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(purgeUserMock).not.toHaveBeenCalled();
  });

  it('a lease conflict answers 409 RUN_LEASE_CONFLICT and never erases (no purgeUser call)', async () => {
    refreshMock.mockResolvedValue({
      ok: false,
      holder: { runContext: 'other run', acquiredAt: '2026-01-01T00:00:00.000Z' },
    });
    const { req, res } = createMockReqRes({ discordId: '900000000000000001', runId: RUN_ID });

    await handleRetentionPurge(deps)(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(payloadOf(res).code).toBe('RUN_LEASE_CONFLICT');
    expect(purgeUserMock).not.toHaveBeenCalled();
  });

  it('an unavailable lease store answers 503 and never calls purgeUser', async () => {
    refreshMock.mockRejectedValue(new RunLeaseUnavailableError(new Error('store down')));
    const { req, res } = createMockReqRes({ discordId: '900000000000000001', runId: RUN_ID });

    await handleRetentionPurge(deps)(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(503);
    expect(purgeUserMock).not.toHaveBeenCalled();
  });

  it('refreshes the lease with (runId, runContext), and BEFORE purgeUser is called', async () => {
    purgeUserMock.mockResolvedValue({
      status: 'purged',
      discordId: '900000000000000001',
      charactersDeleted: 0,
      charactersReHomed: 0,
    });
    const { req, res } = createMockReqRes({
      discordId: '900000000000000001',
      runContext: 'ops retention:purge (dev)',
      runId: RUN_ID,
    });

    await handleRetentionPurge(deps)(req, res, vi.fn());

    expect(refreshMock).toHaveBeenCalledWith(RUN_ID, 'ops retention:purge (dev)');
    expect(refreshMock.mock.invocationCallOrder[0]).toBeLessThan(
      purgeUserMock.mock.invocationCallOrder[0]
    );
  });

  it('refreshes with UNLABELLED_RUN when the body carries no runContext', async () => {
    purgeUserMock.mockResolvedValue({
      status: 'skipped',
      discordId: '900000000000000001',
      reason: 'already_gone',
    });
    const { req, res } = createMockReqRes({ discordId: '900000000000000001', runId: RUN_ID });

    await handleRetentionPurge(deps)(req, res, vi.fn());

    expect(refreshMock).toHaveBeenCalledWith(RUN_ID, UNLABELLED_RUN);
  });
});
