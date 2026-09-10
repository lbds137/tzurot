import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import {
  RetentionRunBeginResponseSchema,
  RetentionRunEndResponseSchema,
} from '@tzurot/common-types/schemas/api/internal';

const { acquireMock, refreshMock, releaseMock, constructedWithMock } = vi.hoisted(() => ({
  acquireMock: vi.fn(),
  refreshMock: vi.fn(),
  releaseMock: vi.fn(),
  constructedWithMock: vi.fn(),
}));

// Identity wrapper (matching retentionPurge.test.ts's pattern) so a plain
// Error from acquire/refresh genuinely rejects the returned promise in this
// test file, instead of being swallowed into a 500 by the real asyncHandler.
vi.mock('../../utils/asyncHandler.js', () => ({ asyncHandler: vi.fn(fn => fn) }));

vi.mock('../../services/retention/runLease.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../services/retention/runLease.js')>();
  return {
    RUN_LEASE_KEY: actual.RUN_LEASE_KEY,
    RUN_LEASE_TTL_MS: actual.RUN_LEASE_TTL_MS,
    RunLeaseUnavailableError: actual.RunLeaseUnavailableError,
    // A real class (constructable), not a mocked arrow — mirrors the
    // AccountEraserService pattern elsewhere in this test suite.
    RunLease: class {
      constructor(redis: unknown) {
        constructedWithMock(redis);
      }
      acquire = acquireMock;
      refresh = refreshMock;
      release = releaseMock;
    },
  };
});

import {
  handleRetentionRunBegin,
  handleRetentionRunEnd,
  refreshRunLeaseOrRespond,
} from './retentionRun.js';
import { RUN_LEASE_TTL_MS, RunLeaseUnavailableError } from '../../services/retention/runLease.js';
import type { RouteDeps } from '../routeDeps.js';

const REDIS_STUB = {};
const depsWithRedis = { redis: REDIS_STUB } as unknown as RouteDeps;
const depsNoRedis = {} as RouteDeps;

const RUN_ID = '3f2b8c1e-9d4a-4c5b-8e7f-1a2b3c4d5e6f';

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleRetentionRunBegin', () => {
  it('begin → 200 {runId, leaseTtlMs}, RunLease constructed with deps.redis, acquire called with the runContext', async () => {
    acquireMock.mockResolvedValue({ acquired: true, runId: RUN_ID });
    const { req, res } = createMockReqRes({ runContext: 'ops retention:purge (dev)' });

    await handleRetentionRunBegin(depsWithRedis)(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = payloadOf(res);
    expect(payload).toEqual({ runId: RUN_ID, leaseTtlMs: RUN_LEASE_TTL_MS });
    expect(RetentionRunBeginResponseSchema.safeParse(payload).success).toBe(true);
    expect(constructedWithMock).toHaveBeenCalledWith(REDIS_STUB);
    expect(acquireMock).toHaveBeenCalledWith('ops retention:purge (dev)');
  });

  it('409 when another run holds the lease, naming that holder', async () => {
    const holder = { runContext: 'other run', acquiredAt: '2026-01-01T00:00:00.000Z' };
    acquireMock.mockResolvedValue({ acquired: false, holder });
    const { req, res } = createMockReqRes({ runContext: 'ctx' });

    await handleRetentionRunBegin(depsWithRedis)(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    const payload = payloadOf(res);
    expect(payload.error).toBe('CONFLICT');
    expect(payload.code).toBe('RUN_IN_PROGRESS');
    expect(payload.holder).toEqual(holder);
    expect(String(payload.message)).toContain(holder.runContext);
    expect(String(payload.message)).toContain(holder.acquiredAt);
  });

  it('409 with a null holder when the holder record is unreadable', async () => {
    acquireMock.mockResolvedValue({ acquired: false, holder: null });
    const { req, res } = createMockReqRes({ runContext: 'ctx' });

    await handleRetentionRunBegin(depsWithRedis)(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(payloadOf(res).holder).toBeNull();
  });

  it('503 with no deps.redis; acquire is never called', async () => {
    const { req, res } = createMockReqRes({ runContext: 'ctx' });

    await handleRetentionRunBegin(depsNoRedis)(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(503);
    expect(acquireMock).not.toHaveBeenCalled();
  });

  it('503 when acquire rejects with RunLeaseUnavailableError', async () => {
    acquireMock.mockRejectedValue(new RunLeaseUnavailableError(new Error('store down')));
    const { req, res } = createMockReqRes({ runContext: 'ctx' });

    await handleRetentionRunBegin(depsWithRedis)(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('propagates a plain Error from acquire rather than answering 503', async () => {
    acquireMock.mockRejectedValue(new Error('unexpected'));
    const { req, res } = createMockReqRes({ runContext: 'ctx' });

    await expect(handleRetentionRunBegin(depsWithRedis)(req, res, vi.fn())).rejects.toThrow(
      'unexpected'
    );
  });

  it('400 on an empty runContext', async () => {
    const { req, res } = createMockReqRes({ runContext: '' });

    await handleRetentionRunBegin(depsWithRedis)(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(acquireMock).not.toHaveBeenCalled();
  });
});

describe('handleRetentionRunEnd', () => {
  it('200 {released:true}, release called with the runId', async () => {
    releaseMock.mockResolvedValue(true);
    const { req, res } = createMockReqRes({ runId: RUN_ID });

    await handleRetentionRunEnd(depsWithRedis)(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = payloadOf(res);
    expect(payload).toEqual({ released: true });
    expect(RetentionRunEndResponseSchema.safeParse(payload).success).toBe(true);
    expect(releaseMock).toHaveBeenCalledWith(RUN_ID);
  });

  it('200 {released:false} when the lease was not this run’s', async () => {
    releaseMock.mockResolvedValue(false);
    const { req, res } = createMockReqRes({ runId: RUN_ID });

    await handleRetentionRunEnd(depsWithRedis)(req, res, vi.fn());

    expect(payloadOf(res)).toEqual({ released: false });
  });

  it('400 on a non-uuid runId; release is never called', async () => {
    const { req, res } = createMockReqRes({ runId: 'not-a-uuid' });

    await handleRetentionRunEnd(depsWithRedis)(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it('503 with no deps.redis', async () => {
    const { req, res } = createMockReqRes({ runId: RUN_ID });

    await handleRetentionRunEnd(depsNoRedis)(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(503);
    expect(releaseMock).not.toHaveBeenCalled();
  });
});

describe('refreshRunLeaseOrRespond', () => {
  it('ok → resolves true, refresh called with (runId, runContext), res.status untouched', async () => {
    refreshMock.mockResolvedValue({ ok: true });
    const { res } = createMockReqRes({});

    const result = await refreshRunLeaseOrRespond(depsWithRedis, res, RUN_ID, 'ctx');

    expect(result).toBe(true);
    expect(refreshMock).toHaveBeenCalledWith(RUN_ID, 'ctx');
    expect(res.status).not.toHaveBeenCalled();
  });

  it('conflict → false + 409 RUN_LEASE_CONFLICT with the holder', async () => {
    const holder = { runContext: 'other run', acquiredAt: '2026-01-01T00:00:00.000Z' };
    refreshMock.mockResolvedValue({ ok: false, holder });
    const { res } = createMockReqRes({});

    const result = await refreshRunLeaseOrRespond(depsWithRedis, res, 'some-run-id', 'ctx');

    expect(result).toBe(false);
    expect(res.status).toHaveBeenCalledWith(409);
    const payload = payloadOf(res);
    expect(payload.code).toBe('RUN_LEASE_CONFLICT');
    expect(payload.holder).toEqual(holder);
  });

  it('RunLeaseUnavailableError → false + 503', async () => {
    refreshMock.mockRejectedValue(new RunLeaseUnavailableError(new Error('store down')));
    const { res } = createMockReqRes({});

    const result = await refreshRunLeaseOrRespond(depsWithRedis, res, 'run-id', 'ctx');

    expect(result).toBe(false);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('no redis → false + 503', async () => {
    const { res } = createMockReqRes({});

    const result = await refreshRunLeaseOrRespond(depsNoRedis, res, 'run-id', 'ctx');

    expect(result).toBe(false);
    expect(res.status).toHaveBeenCalledWith(503);
  });
});
