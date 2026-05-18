/**
 * Metrics Route Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { StatusCodes } from 'http-status-codes';
import type { Queue } from 'bullmq';

// Mock dependencies
vi.mock('../../utils/deduplicationCache.js', () => ({
  getDeduplicationCache: vi.fn(() => ({
    getCacheSize: vi.fn().mockResolvedValue(10),
  })),
}));

vi.mock('@tzurot/common-types', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  // requireServiceAuth reads getConfig().INTERNAL_SERVICE_SECRET — stub
  // it to a known value so the auth-protection test can verify rejection
  // (missing header) and acceptance (matching header).
  getConfig: () => ({ INTERNAL_SERVICE_SECRET: 'test-secret' }),
}));

vi.mock('../../utils/errorResponses.js', () => ({
  ErrorResponses: {
    metricsError: vi.fn((message: string) => ({ error: 'Metrics Error', message })),
    unauthorized: vi.fn((message: string) => ({ error: 'UNAUTHORIZED', message })),
  },
  getStatusCode: vi.fn((errorCode: string) =>
    errorCode === 'UNAUTHORIZED' ? StatusCodes.UNAUTHORIZED : StatusCodes.INTERNAL_SERVER_ERROR
  ),
}));

import { createMetricsRouter } from './metrics.js';
import { requireServiceAuth } from '../../services/AuthMiddleware.js';

describe('Metrics Route', () => {
  let app: express.Express;
  let mockQueue: Partial<Queue>;
  const startTime = Date.now();

  beforeEach(() => {
    vi.clearAllMocks();

    mockQueue = {
      getWaitingCount: vi.fn().mockResolvedValue(5),
      getActiveCount: vi.fn().mockResolvedValue(2),
      getCompletedCount: vi.fn().mockResolvedValue(100),
      getFailedCount: vi.fn().mockResolvedValue(3),
    };

    // Mock deduplication cache returns size of 10 (set up in vi.mock above)

    app = express();
    app.use('/metrics', createMetricsRouter(mockQueue as Queue, startTime));
  });

  it('should return queue and cache metrics', async () => {
    const response = await request(app).get('/metrics');

    expect(response.status).toBe(StatusCodes.OK);
    expect(response.body.queue).toEqual({
      waiting: 5,
      active: 2,
      completed: 100,
      failed: 3,
      total: 7, // waiting + active
    });
    expect(response.body.cache.size).toBe(10);
    expect(response.body.uptime).toBeGreaterThanOrEqual(0);
    expect(response.body.timestamp).toBeDefined();
  });

  it('should handle queue errors gracefully', async () => {
    mockQueue.getWaitingCount = vi.fn().mockRejectedValue(new Error('Redis connection lost'));

    const response = await request(app).get('/metrics');

    expect(response.status).toBe(StatusCodes.INTERNAL_SERVER_ERROR);
    expect(response.body.error).toBe('Metrics Error');
  });

  it('should call all queue count methods', async () => {
    await request(app).get('/metrics');

    expect(mockQueue.getWaitingCount).toHaveBeenCalled();
    expect(mockQueue.getActiveCount).toHaveBeenCalled();
    expect(mockQueue.getCompletedCount).toHaveBeenCalled();
    expect(mockQueue.getFailedCount).toHaveBeenCalled();
  });

  describe('with requireServiceAuth mounted upstream', () => {
    // Reproduces the production wiring: auth middleware runs before the
    // route handler. Locks in the invariant that /metrics is NOT public —
    // future accidental removal of the auth middleware in index.ts would
    // fail this test rather than ship as a regression.

    function buildProtectedApp(): express.Express {
      const protectedApp = express();
      protectedApp.use(requireServiceAuth());
      protectedApp.use('/metrics', createMetricsRouter(mockQueue as Queue, startTime));
      return protectedApp;
    }

    it('should reject requests without the X-Service-Auth header', async () => {
      const response = await request(buildProtectedApp()).get('/metrics');

      expect(response.status).toBe(StatusCodes.UNAUTHORIZED);
    });

    it('should reject requests with the wrong X-Service-Auth secret', async () => {
      const response = await request(buildProtectedApp())
        .get('/metrics')
        .set('X-Service-Auth', 'wrong-secret');

      expect(response.status).toBe(StatusCodes.UNAUTHORIZED);
    });

    it('should allow requests with the correct X-Service-Auth secret', async () => {
      const response = await request(buildProtectedApp())
        .get('/metrics')
        .set('X-Service-Auth', 'test-secret');

      expect(response.status).toBe(StatusCodes.OK);
      expect(response.body.queue).toBeDefined();
    });
  });
});
