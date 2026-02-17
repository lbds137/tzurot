/**
 * Tests for Shapes.inc Import Routes
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

import { createShapesImportRoutes } from './import.js';
import type { PrismaClient } from '@tzurot/common-types';
import { findRoute, getRouteHandler } from '../../../test/expressRouterUtils.js';

// Mock Prisma
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
  personality: {
    findFirst: vi.fn().mockResolvedValue({ id: 'existing-pers-id' }),
  },
  importJob: {
    findFirst: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue({ id: 'import-job-123' }),
    findMany: vi.fn().mockResolvedValue([]),
  },
  $transaction: vi.fn().mockImplementation(async (callback: (tx: unknown) => Promise<void>) => {
    const mockTx = {
      user: {
        create: vi.fn().mockResolvedValue({ id: 'user-uuid-123' }),
        update: vi.fn().mockResolvedValue({ id: 'user-uuid-123' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({ defaultPersonaId: null }),
      },
      persona: { create: vi.fn().mockResolvedValue({ id: 'persona-uuid-123' }) },
    };
    await callback(mockTx);
  }),
};

// Mock Queue
const mockQueue = {
  add: vi.fn().mockResolvedValue({ id: 'bullmq-job-id' }),
};

function createMockReqRes(body: Record<string, unknown> = {}) {
  const req = {
    body,
    userId: 'discord-user-123',
  } as unknown as Request & { userId: string };

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  return { req, res };
}

describe('Shapes Import Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('route factory', () => {
    it('should have POST / and GET /jobs routes', () => {
      const router = createShapesImportRoutes(
        mockPrisma as unknown as PrismaClient,
        mockQueue as never
      );

      expect(findRoute(router, 'post', '/')).toBeDefined();
      expect(findRoute(router, 'get', '/jobs')).toBeDefined();
    });
  });

  describe('POST / (create import job)', () => {
    async function callImportHandler(body: Record<string, unknown>) {
      const { req, res } = createMockReqRes(body);
      const router = createShapesImportRoutes(
        mockPrisma as unknown as PrismaClient,
        mockQueue as never
      );
      const handler = getRouteHandler(router, 'post', '/');
      await handler(req, res);
      return { req, res };
    }

    it('should reject missing sourceSlug', async () => {
      const { res } = await callImportHandler({});

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'VALIDATION_ERROR' }));
    });

    it('should reject empty sourceSlug', async () => {
      const { res } = await callImportHandler({ sourceSlug: '   ' });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject duplicate pending import', async () => {
      mockPrisma.importJob.findFirst.mockResolvedValueOnce({
        id: 'existing-job',
        status: 'in_progress',
      });

      const { res } = await callImportHandler({ sourceSlug: 'test-shape' });

      expect(res.status).toHaveBeenCalledWith(409);
    });

    it('should create import job and enqueue BullMQ job', async () => {
      const { res } = await callImportHandler({ sourceSlug: 'Test-Shape' });

      expect(mockPrisma.importJob.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            sourceSlug: 'test-shape',
            sourceService: 'shapes_inc',
            status: 'pending',
            importType: 'full',
          }),
        })
      );

      expect(mockQueue.add).toHaveBeenCalledWith(
        'shapes-import',
        expect.objectContaining({
          sourceSlug: 'test-shape',
          importType: 'full',
        }),
        expect.objectContaining({ jobId: expect.any(String) })
      );

      expect(res.status).toHaveBeenCalledWith(202);
    });

    it('should handle memory_only import type', async () => {
      const { res } = await callImportHandler({
        sourceSlug: 'test-shape',
        importType: 'memory_only',
        existingPersonalityId: 'existing-pers-id',
      });

      expect(mockQueue.add).toHaveBeenCalledWith(
        'shapes-import',
        expect.objectContaining({
          importType: 'memory_only',
          existingPersonalityId: 'existing-pers-id',
        }),
        expect.any(Object)
      );

      expect(res.status).toHaveBeenCalledWith(202);
    });

    it('should reject memory_only without existingPersonalityId', async () => {
      const { res } = await callImportHandler({
        sourceSlug: 'test-shape',
        importType: 'memory_only',
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('GET /jobs (list import history)', () => {
    async function callListHandler() {
      const { req, res } = createMockReqRes();
      const router = createShapesImportRoutes(
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

    it('should return import jobs for existing user', async () => {
      mockPrisma.importJob.findMany.mockResolvedValueOnce([
        {
          id: 'job-1',
          sourceSlug: 'test-shape',
          status: 'completed',
          importType: 'full',
          memoriesImported: 50,
          memoriesFailed: 2,
          createdAt: new Date(),
          completedAt: new Date(),
          errorMessage: null,
        },
      ]);

      const { res } = await callListHandler();

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          jobs: expect.arrayContaining([
            expect.objectContaining({
              sourceSlug: 'test-shape',
              status: 'completed',
            }),
          ]),
        })
      );
    });
  });
});
