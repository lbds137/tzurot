/**
 * Tests for Shapes.inc Export Routes (Async)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// Mock dependencies
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

vi.mock('../../../services/AuthMiddleware.js', () => ({
  requireUserAuth: vi.fn(() => vi.fn((_req: unknown, _res: unknown, next: () => void) => next())),
}));

vi.mock('../../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

import { createShapesExportRoutes } from './export.js';
import type { PrismaClient } from '@tzurot/common-types';
import { findRoute, getRouteHandler } from '../../../test/expressRouterUtils.js';

/** Mocks for exportJob operations inside $transaction */
const mockTxExportJob = {
  findFirst: vi.fn().mockResolvedValue(null),
  upsert: vi.fn().mockResolvedValue({ id: 'export-job-123' }),
};

const mockPrisma = {
  user: {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'user-uuid-123' }),
    update: vi.fn().mockResolvedValue({ id: 'user-uuid-123' }),
    upsert: vi.fn().mockResolvedValue({ id: 'user-uuid-123' }),
    findFirst: vi.fn().mockResolvedValue({ id: 'user-uuid-123' }),
  },
  persona: {
    create: vi.fn().mockResolvedValue({ id: 'persona-uuid-123' }),
  },
  userCredential: {
    findFirst: vi.fn().mockResolvedValue(null),
  },
  exportJob: {
    findFirst: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue({ id: 'export-job-123' }),
    findMany: vi.fn().mockResolvedValue([]),
  },
  $transaction: vi.fn().mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
    const mockTx = {
      user: {
        create: vi.fn().mockResolvedValue({ id: 'user-uuid-123' }),
        update: vi.fn().mockResolvedValue({ id: 'user-uuid-123' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({ defaultPersonaId: null }),
      },
      persona: { create: vi.fn().mockResolvedValue({ id: 'persona-uuid-123' }) },
      exportJob: mockTxExportJob,
    };
    return callback(mockTx);
  }),
};

const mockQueue = {
  add: vi.fn().mockResolvedValue({ id: 'bullmq-job-id' }),
};

function createMockReqRes(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
  const req = {
    body,
    query,
    userId: 'discord-user-123',
  } as unknown as Request & { userId: string };

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  return { req, res };
}

describe('Shapes Export Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('route factory', () => {
    it('should have POST / and GET /jobs routes', () => {
      const router = createShapesExportRoutes(
        mockPrisma as unknown as PrismaClient,
        mockQueue as never
      );

      expect(findRoute(router, 'post', '/')).toBeDefined();
      expect(findRoute(router, 'get', '/jobs')).toBeDefined();
    });
  });

  describe('POST / (create export job)', () => {
    async function callExportHandler(body: Record<string, unknown>) {
      const { req, res } = createMockReqRes(body);
      const router = createShapesExportRoutes(
        mockPrisma as unknown as PrismaClient,
        mockQueue as never
      );
      const handler = getRouteHandler(router, 'post', '/');
      await handler(req, res);
      return { req, res };
    }

    it('should reject missing slug', async () => {
      const { res } = await callExportHandler({});

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'VALIDATION_ERROR' }));
    });

    it('should return 403 when no credentials found', async () => {
      mockPrisma.userCredential.findFirst.mockResolvedValue(null);
      const { res } = await callExportHandler({ slug: 'test-shape' });

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should return 409 when export already in progress', async () => {
      mockPrisma.userCredential.findFirst.mockResolvedValue({ id: 'cred-id' });
      mockTxExportJob.findFirst.mockResolvedValueOnce({
        id: 'existing-job',
        status: 'in_progress',
      });

      const { res } = await callExportHandler({ slug: 'test-shape' });

      expect(res.status).toHaveBeenCalledWith(409);
    });

    it('should create export job and enqueue BullMQ job', async () => {
      mockPrisma.userCredential.findFirst.mockResolvedValue({ id: 'cred-id' });
      mockTxExportJob.findFirst.mockResolvedValue(null);

      const { res } = await callExportHandler({ slug: 'Test-Shape' });

      expect(mockTxExportJob.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            sourceSlug: 'test-shape',
            sourceService: 'shapes_inc',
            status: 'pending',
            format: 'json',
          }),
        })
      );

      expect(mockQueue.add).toHaveBeenCalledWith(
        'shapes-export',
        expect.objectContaining({
          sourceSlug: 'test-shape',
          format: 'json',
        }),
        expect.objectContaining({ jobId: expect.any(String) })
      );

      expect(res.status).toHaveBeenCalledWith(202);
    });

    it('should accept markdown format', async () => {
      mockPrisma.userCredential.findFirst.mockResolvedValue({ id: 'cred-id' });
      mockTxExportJob.findFirst.mockResolvedValue(null);

      const { res } = await callExportHandler({ slug: 'test-shape', format: 'markdown' });

      expect(mockTxExportJob.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            format: 'markdown',
          }),
        })
      );

      expect(res.status).toHaveBeenCalledWith(202);
    });
  });

  describe('GET /jobs (list export history)', () => {
    async function callListHandler() {
      const { req, res } = createMockReqRes();
      const router = createShapesExportRoutes(
        mockPrisma as unknown as PrismaClient,
        mockQueue as never
      );
      const handler = getRouteHandler(router, 'get', '/jobs');
      await handler(req, res);
      return { req, res };
    }

    it('should return empty list for unknown user', async () => {
      mockPrisma.user.findFirst.mockResolvedValueOnce(null);
      const { res } = await callListHandler();

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ jobs: [] }));
    });

    it('should return export jobs with download URLs', async () => {
      mockPrisma.exportJob.findMany.mockResolvedValueOnce([
        {
          id: 'job-1',
          sourceSlug: 'test-shape',
          status: 'completed',
          format: 'json',
          fileName: 'test-shape-export.json',
          fileSizeBytes: 1024,
          createdAt: new Date(),
          completedAt: new Date(),
          expiresAt: new Date(Date.now() + 86400000),
          errorMessage: null,
          exportMetadata: null,
        },
      ]);

      const { res } = await callListHandler();

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          jobs: expect.arrayContaining([
            expect.objectContaining({
              sourceSlug: 'test-shape',
              status: 'completed',
              downloadUrl: expect.stringContaining('/exports/job-1'),
            }),
          ]),
        })
      );
    });
  });
});
