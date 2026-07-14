/**
 * Tests for POST /admin/broadcast.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import type { Queue } from 'bullmq';

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

const { resolveMock, enqueueMock } = vi.hoisted(() => ({
  resolveMock: vi.fn(),
  enqueueMock: vi.fn(),
}));
vi.mock('../../services/releaseBroadcast.js', () => ({
  resolveEligibleRecipients: resolveMock,
  enqueueBroadcast: enqueueMock,
}));

import { handleBroadcast } from './broadcast.js';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { RouteDeps } from '../routeDeps.js';

const RELEASE_ID = '123e4567-e89b-42d3-a456-426614174000';

function makeDeps(withQueue = true): RouteDeps {
  return {
    prisma: {} as unknown as PrismaClient,
    ...(withQueue ? { releaseBroadcastQueue: {} as unknown as Queue } : {}),
  } as unknown as RouteDeps;
}

function createMockReqRes(body: Record<string, unknown>) {
  const req = { body } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

describe('POST /admin/broadcast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 503 when the queue dep is missing', async () => {
    const handler = handleBroadcast(makeDeps(false));
    const { req, res } = createMockReqRes({ message: 'hi' });

    await (handler as (req: Request, res: Response) => void)(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('dry-run resolves the audience and never enqueues', async () => {
    resolveMock.mockResolvedValueOnce([
      { userId: 'u1', discordUserId: 'd1', username: 'alice' },
      { userId: 'u2', discordUserId: 'd2', username: 'bob' },
    ]);
    const handler = handleBroadcast(makeDeps());
    const { req, res } = createMockReqRes({ message: 'hi', dryRun: true, level: 'minor' });

    await handler(req, res, vi.fn());

    expect(resolveMock).toHaveBeenCalledWith(expect.anything(), 'minor');
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      dryRun: true,
      eligibleCount: 2,
      sample: [{ username: 'alice' }, { username: 'bob' }],
    });
  });

  it('real run enqueues with the supplied label', async () => {
    enqueueMock.mockResolvedValueOnce({
      ok: true,
      releaseId: RELEASE_ID,
      recipients: 2,
      batches: 1,
    });
    const handler = handleBroadcast(makeDeps());
    const { req, res } = createMockReqRes({ message: 'hi', label: 'adhoc-test-1', confirm: true });

    await handler(req, res, vi.fn());

    expect(enqueueMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      version: 'adhoc-test-1',
      level: 'major',
      body: 'hi',
    });
    expect(res.json).toHaveBeenCalledWith({
      dryRun: false,
      version: 'adhoc-test-1',
      releaseId: RELEASE_ID,
      recipients: 2,
      batches: 1,
    });
  });

  it('derives a timestamped default label when omitted', async () => {
    enqueueMock.mockResolvedValueOnce({
      ok: true,
      releaseId: RELEASE_ID,
      recipients: 0,
      batches: 0,
    });
    const handler = handleBroadcast(makeDeps());
    const { req, res } = createMockReqRes({ message: 'hi', confirm: true });

    await handler(req, res, vi.fn());

    const options = enqueueMock.mock.calls[0][2] as { version: string };
    expect(options.version).toMatch(/^adhoc-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/);
  });

  it('surfaces already-announced as a validation error', async () => {
    enqueueMock.mockResolvedValueOnce({ ok: false, reason: 'already-announced' });
    const handler = handleBroadcast(makeDeps());
    const { req, res } = createMockReqRes({ message: 'hi', label: 'dupe', confirm: true });

    await handler(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects an unconfirmed real send with 400 (the double-key gate)', async () => {
    const handler = handleBroadcast(makeDeps());
    const { req, res } = createMockReqRes({ message: 'hi' });

    await handler(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(resolveMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid body with 400 before touching anything', async () => {
    const handler = handleBroadcast(makeDeps());
    const { req, res } = createMockReqRes({ message: '' });

    await handler(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(resolveMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});
