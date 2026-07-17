/**
 * Tests for the internal secret-rotation status route.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

const mockPrisma = {
  secretRotation: {
    findMany: vi.fn(),
  },
};

import { handleSecretRotationStatus } from './secretRotationStatus.js';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { RouteDeps } from '../routeDeps.js';

function makeDeps(): RouteDeps {
  return { prisma: mockPrisma as unknown as PrismaClient } as unknown as RouteDeps;
}

function createMockReqRes() {
  const req = {} as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

describe('GET /internal/secret-rotations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('computes overdueDays as days PAST the interval, clamped at zero', async () => {
    mockPrisma.secretRotation.findMany.mockResolvedValueOnce([
      {
        // 200 days ago on a 180-day interval → 20 days overdue
        name: 'byok-encryption-key',
        rotatedAt: new Date('2025-12-29T12:00:00.000Z'),
        intervalDays: 180,
      },
      {
        // 10 days ago on a 365-day interval → within interval, clamps to 0
        name: 'internal-service-secret',
        rotatedAt: new Date('2026-07-07T12:00:00.000Z'),
        intervalDays: 365,
      },
    ]);
    const handler = handleSecretRotationStatus(makeDeps());
    const { req, res } = createMockReqRes();

    await handler(req, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith({
      entries: [
        {
          name: 'byok-encryption-key',
          rotatedAt: '2025-12-29T12:00:00.000Z',
          intervalDays: 180,
          overdueDays: 20,
        },
        {
          name: 'internal-service-secret',
          rotatedAt: '2026-07-07T12:00:00.000Z',
          intervalDays: 365,
          overdueDays: 0,
        },
      ],
      overdueCount: 1,
    });
  });

  it('returns an empty ledger cleanly (pre-seed state)', async () => {
    mockPrisma.secretRotation.findMany.mockResolvedValueOnce([]);
    const handler = handleSecretRotationStatus(makeDeps());
    const { req, res } = createMockReqRes();

    await handler(req, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith({ entries: [], overdueCount: 0 });
  });

  it('reads with a bounded take (03-database bounded-query rule)', async () => {
    mockPrisma.secretRotation.findMany.mockResolvedValueOnce([]);
    const handler = handleSecretRotationStatus(makeDeps());
    const { req, res } = createMockReqRes();

    await handler(req, res, vi.fn());

    expect(mockPrisma.secretRotation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 })
    );
  });
});
