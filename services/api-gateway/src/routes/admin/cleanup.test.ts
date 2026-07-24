/**
 * Tests for Admin Cleanup Routes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCleanupRoute } from './cleanup.js';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { ConversationRetentionService } from '@tzurot/conversation-history';
import type { RouteDeps } from '../routeDeps.js';
import express from 'express';
import request from 'supertest';
import { stubRouteResolvers } from '../../test/shared-route-test-utils.js';

// Mock logger but preserve CLEANUP_DEFAULTS
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

// Mock requireOwnerAuth to allow requests through in tests
vi.mock('../../services/AuthMiddleware.js', () => ({
  requireOwnerAuth:
    () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
      next();
    },
}));

describe('Admin Cleanup Routes', () => {
  let mockService: {
    cleanupOldHistory: ReturnType<typeof vi.fn>;
    cleanupSoftDeletedMessages: ReturnType<typeof vi.fn>;
  };
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();

    mockService = {
      cleanupOldHistory: vi.fn().mockResolvedValue(0),
      cleanupSoftDeletedMessages: vi.fn().mockResolvedValue(0),
    };

    const deps: RouteDeps = {
      ...stubRouteResolvers(),
      prisma: {} as PrismaClient,
      retentionService: mockService as unknown as ConversationRetentionService,
    };
    app = express();
    app.use(express.json());
    app.use('/admin/cleanup', createCleanupRoute(deps));
    // Add error handler for debugging
    app.use(
      (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(500).json({ error: err.message, stack: err.stack });
      }
    );
  });

  describe('POST /admin/cleanup', () => {
    it('should cleanup history with default daysToKeep', async () => {
      mockService.cleanupOldHistory.mockResolvedValue(10);

      const response = await request(app).post('/admin/cleanup');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.historyDeleted).toBe(10);
      expect(response.body.daysKept).toBe(30);
      expect(response.body.message).toContain('10 history messages');
      expect(response.body.timestamp).toBeDefined();

      expect(mockService.cleanupOldHistory).toHaveBeenCalledWith(30);
    });

    it('should accept custom daysToKeep', async () => {
      mockService.cleanupOldHistory.mockResolvedValue(20);

      const response = await request(app).post('/admin/cleanup').send({ daysToKeep: 7 });

      expect(response.status).toBe(200);
      expect(response.body.daysKept).toBe(7);
      expect(mockService.cleanupOldHistory).toHaveBeenCalledWith(7);
    });

    it('folds soft-deleted hard-deletes into historyDeleted (scheduled-job parity seam)', async () => {
      // The seam: cleanup must CALL cleanupSoftDeletedMessages (no daysToKeep
      // arg — the soft-delete grace is its own retention window) and SUM its
      // count into historyDeleted. A dropped call or wrong operator passes
      // every other test in this suite trivially.
      mockService.cleanupOldHistory.mockResolvedValue(10);
      mockService.cleanupSoftDeletedMessages.mockResolvedValue(4);

      const response = await request(app).post('/admin/cleanup');

      expect(response.status).toBe(200);
      expect(response.body.historyDeleted).toBe(14);
      expect(mockService.cleanupSoftDeletedMessages).toHaveBeenCalledWith();
    });

    it('should return validation error for daysToKeep less than 1', async () => {
      const response = await request(app).post('/admin/cleanup').send({ daysToKeep: 0 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('VALIDATION_ERROR');
      expect(response.body.message).toContain('daysToKeep must be a number between 1 and 365');
    });

    it('should return validation error for daysToKeep greater than 365', async () => {
      const response = await request(app).post('/admin/cleanup').send({ daysToKeep: 400 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('VALIDATION_ERROR');
      expect(response.body.message).toContain('daysToKeep must be a number between 1 and 365');
    });

    it('should return validation error for non-numeric daysToKeep', async () => {
      const response = await request(app).post('/admin/cleanup').send({ daysToKeep: 'invalid' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('VALIDATION_ERROR');
      expect(response.body.message).toContain('daysToKeep must be a number between 1 and 365');
    });

    it('should handle zero deletions gracefully', async () => {
      // Ensure mocks are set up properly before this test
      mockService.cleanupOldHistory.mockResolvedValue(0);

      const response = await request(app).post('/admin/cleanup');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.historyDeleted).toBe(0);
      expect(response.body.message).toContain('0 history messages');
    });

    it('should accept boundary value daysToKeep=1', async () => {
      mockService.cleanupOldHistory.mockResolvedValue(100);

      const response = await request(app).post('/admin/cleanup').send({ daysToKeep: 1 });

      expect(response.status).toBe(200);
      expect(response.body.daysKept).toBe(1);
    });

    it('should accept boundary value daysToKeep=365', async () => {
      mockService.cleanupOldHistory.mockResolvedValue(0);

      const response = await request(app).post('/admin/cleanup').send({ daysToKeep: 365 });

      expect(response.status).toBe(200);
      expect(response.body.daysKept).toBe(365);
    });
  });
});
