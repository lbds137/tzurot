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

vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return {
    ...actual,
    getConfig: () => ({ INTERNAL_SERVICE_SECRET: 'test-secret' }),
  };
});

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

// Mock only `ErrorResponses` (the call-site-specific shape) — let the real
// `getStatusCode` run so any error code mapping is correct out of the box.
// Manual code-by-code mocking masked failures when new codes got added.
vi.mock('../../utils/errorResponses.js', async () => {
  const actual = await vi.importActual<typeof import('../../utils/errorResponses.js')>(
    '../../utils/errorResponses.js'
  );
  return {
    ...actual,
    ErrorResponses: {
      ...actual.ErrorResponses,
      metricsError: vi.fn((message: string) => ({ error: 'Metrics Error', message })),
      unauthorized: vi.fn((message: string) => ({ error: 'UNAUTHORIZED', message })),
    },
  };
});

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

    // Production maps `ErrorCode.UNAUTHORIZED` → HTTP 403 (FORBIDDEN), not
    // 401 (UNAUTHORIZED). Whether that's semantically right is a separate
    // backlog question — these tests reflect actual behavior, not aspiration.
    it('should reject requests without the X-Service-Auth header', async () => {
      const response = await request(buildProtectedApp()).get('/metrics');

      expect(response.status).toBe(StatusCodes.FORBIDDEN);
    });

    it('should reject requests with the wrong X-Service-Auth secret', async () => {
      const response = await request(buildProtectedApp())
        .get('/metrics')
        .set('X-Service-Auth', 'wrong-secret');

      expect(response.status).toBe(StatusCodes.FORBIDDEN);
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
