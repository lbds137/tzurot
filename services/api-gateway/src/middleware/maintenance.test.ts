import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import type { MaintenanceFlag } from '@tzurot/common-types/services/MaintenanceFlag';
import { createMaintenanceMiddleware } from './maintenance.js';

function mockFlag(active: boolean | Error): MaintenanceFlag {
  return {
    isActive:
      active instanceof Error
        ? vi.fn().mockRejectedValue(active)
        : vi.fn().mockResolvedValue(active),
  } as unknown as MaintenanceFlag;
}

function mockRes(): Response {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  } as unknown as Response;
  (res.status as ReturnType<typeof vi.fn>).mockReturnValue(res);
  return res;
}

/**
 * Run the middleware and flush the microtask queue its promise chain rides on
 * (no timers involved — isActive resolves/rejects synchronously in the mocks,
 * so a few ticks deterministically settle the chain).
 */
async function run(flag: MaintenanceFlag, res: Response): Promise<ReturnType<typeof vi.fn>> {
  const next = vi.fn();
  createMaintenanceMiddleware(flag)({} as Request, res, next);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  return next;
}

describe('createMaintenanceMiddleware', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes requests through when maintenance is inactive', async () => {
    const res = mockRes();
    const next = await run(mockFlag(false), res);

    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('503s with the MAINTENANCE contract when active', async () => {
    const res = mockRes();
    const next = await run(mockFlag(true), res);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'SERVICE_UNAVAILABLE',
        message: expect.stringContaining('maintenance'),
      })
    );
  });

  it('forwards an unexpected isActive rejection to next (error handler)', async () => {
    // isActive fails open internally, so this path is belt-and-suspenders —
    // but if it ever rejects, the request chain must not hang.
    const res = mockRes();
    const next = await run(mockFlag(new Error('boom')), res);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(res.status).not.toHaveBeenCalled();
  });
});
