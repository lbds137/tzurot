import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { RetentionPurgeResponseSchema } from '@tzurot/common-types/schemas/api/internal';

const purgeUserMock = vi.hoisted(() => vi.fn());

vi.mock('../../utils/asyncHandler.js', () => ({ asyncHandler: vi.fn(fn => fn) }));
vi.mock('../../services/retention/RetentionPurgeService.js', () => ({
  // Plain function: constructable (arrows are not).
  RetentionPurgeService: function MockRetentionPurgeService() {
    return { purgeUser: purgeUserMock };
  },
}));

import { handleRetentionPurge } from './retentionPurge.js';
import { SuperuserDeletionError } from '../../services/AccountDeletionService.js';
import type { RouteDeps } from '../routeDeps.js';

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

describe('POST /internal/retention/purge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    });

    await handleRetentionPurge({} as RouteDeps)(req, res, vi.fn());

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
    const { req, res } = createMockReqRes({ discordId: '900000000000000001' });

    await handleRetentionPurge({} as RouteDeps)(req, res, vi.fn());

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
    const { req, res } = createMockReqRes({ discordId: '900000000000000001' });

    await handleRetentionPurge({} as RouteDeps)(req, res, vi.fn());

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
    const { req, res } = createMockReqRes({ discordId: '900000000000000001' });

    await handleRetentionPurge({} as RouteDeps)(req, res, vi.fn());

    const payload = payloadOf(res);
    expect(payload).toMatchObject({ reason: 'breaker_tripped' });
    expect(payload.detail).toContain('Circuit breaker');
    expect(RetentionPurgeResponseSchema.safeParse(payload).success).toBe(true);
  });

  it('rejects a malformed Discord id without touching the service', async () => {
    const { req, res } = createMockReqRes({ discordId: 'not-a-snowflake' });

    await handleRetentionPurge({} as RouteDeps)(req, res, vi.fn());

    expect(purgeUserMock).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(200);
  });

  it('maps a superuser target to 403 rather than swallowing it as a skip', async () => {
    // The predicate excludes superusers, so this can only mean the predicate
    // and the erasure backstop disagree — worth surfacing, not normalising.
    purgeUserMock.mockRejectedValue(new SuperuserDeletionError());
    const { req, res } = createMockReqRes({ discordId: '900000000000000001' });

    await handleRetentionPurge({} as RouteDeps)(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('propagates any other error to the error handler', async () => {
    purgeUserMock.mockRejectedValue(new Error('database exploded'));
    const { req, res } = createMockReqRes({ discordId: '900000000000000001' });

    await expect(handleRetentionPurge({} as RouteDeps)(req, res, vi.fn())).rejects.toThrow(
      'database exploded'
    );
  });
});
