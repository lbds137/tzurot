/**
 * Tests for Admin Cleanup Routes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCleanupRoute } from './cleanup.js';
import type { ConversationRetentionService } from '@tzurot/common-types';
import express from 'express';
import request from 'supertest';

// Mock logger but preserve CLEANUP_DEFAULTS
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
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
    cleanupOldTombstones: ReturnType<typeof vi.fn>;
  };
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();

    mockService = {
      cleanupOldHistory: vi.fn().mockResolvedValue(0),
      cleanupOldTombstones: vi.fn().mockResolvedValue(0),
    };

    app = express();
    app.use(express.json());
    app.use(
      '/admin/cleanup',
      createCleanupRoute(mockService as unknown as ConversationRetentionService)
    );
    // Add error handler for debugging
    app.use(
      (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(500).json({ error: err.message, stack: err.stack });
      }
    );
  });

  describe('POST /admin/cleanup', () => {
    it('should cleanup all targets with default daysToKeep', async () => {
      mockService.cleanupOldHistory.mockResolvedValue(10);
      mockService.cleanupOldTombstones.mockResolvedValue(5);

      const response = await request(app).post('/admin/cleanup');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.historyDeleted).toBe(10);
      expect(response.body.tombstonesDeleted).toBe(5);
      expect(response.body.daysKept).toBe(30);
      expect(response.body.message).toContain('10 history messages');
      expect(response.body.message).toContain('5 tombstones deleted');
      expect(response.body.timestamp).toBeDefined();

      expect(mockService.cleanupOldHistory).toHaveBeenCalledWith(30);
      expect(mockService.cleanupOldTombstones).toHaveBeenCalledWith(30);
    });

    it('should accept custom daysToKeep', async () => {
      mockService.cleanupOldHistory.mockResolvedValue(20);
      mockService.cleanupOldTombstones.mockResolvedValue(10);

      const response = await request(app).post('/admin/cleanup').send({ daysToKeep: 7 });

      expect(response.status).toBe(200);
      expect(response.body.daysKept).toBe(7);
      expect(mockService.cleanupOldHistory).toHaveBeenCalledWith(7);
      expect(mockService.cleanupOldTombstones).toHaveBeenCalledWith(7);
    });

    it('should cleanup only history when target is "history"', async () => {
      mockService.cleanupOldHistory.mockResolvedValue(15);

      const response = await request(app).post('/admin/cleanup').send({ target: 'history' });

      expect(response.status).toBe(200);
      expect(response.body.historyDeleted).toBe(15);
      expect(response.body.tombstonesDeleted).toBe(0);
      expect(mockService.cleanupOldHistory).toHaveBeenCalledWith(30);
      expect(mockService.cleanupOldTombstones).not.toHaveBeenCalled();
    });

    it('should cleanup only tombstones when target is "tombstones"', async () => {
      mockService.cleanupOldTombstones.mockResolvedValue(8);

      const response = await request(app).post('/admin/cleanup').send({ target: 'tombstones' });

      expect(response.status).toBe(200);
      expect(response.body.historyDeleted).toBe(0);
      expect(response.body.tombstonesDeleted).toBe(8);
      expect(mockService.cleanupOldHistory).not.toHaveBeenCalled();
      expect(mockService.cleanupOldTombstones).toHaveBeenCalledWith(30);
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

    it('should return validation error for invalid target', async () => {
      const response = await request(app).post('/admin/cleanup').send({ target: 'invalid' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('VALIDATION_ERROR');
      expect(response.body.message).toContain('target must be "history", "tombstones", or "all"');
    });

    it('should handle zero deletions gracefully', async () => {
      // Ensure mocks are set up properly before this test
      mockService.cleanupOldHistory.mockResolvedValue(0);
      mockService.cleanupOldTombstones.mockResolvedValue(0);

      const response = await request(app).post('/admin/cleanup').send({ target: 'all' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.historyDeleted).toBe(0);
      expect(response.body.tombstonesDeleted).toBe(0);
      expect(response.body.message).toContain('0 history messages');
      expect(response.body.message).toContain('0 tombstones deleted');
    });

    it('should accept boundary value daysToKeep=1', async () => {
      mockService.cleanupOldHistory.mockResolvedValue(100);
      mockService.cleanupOldTombstones.mockResolvedValue(50);

      const response = await request(app).post('/admin/cleanup').send({ daysToKeep: 1 });

      expect(response.status).toBe(200);
      expect(response.body.daysKept).toBe(1);
    });

    it('should accept boundary value daysToKeep=365', async () => {
      mockService.cleanupOldHistory.mockResolvedValue(0);
      mockService.cleanupOldTombstones.mockResolvedValue(0);

      const response = await request(app).post('/admin/cleanup').send({ daysToKeep: 365 });

      expect(response.status).toBe(200);
      expect(response.body.daysKept).toBe(365);
    });
  });
});
