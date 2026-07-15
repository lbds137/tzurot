/**
 * Tests for Account Data-Rights Export Routes (Async)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

vi.mock('../../../services/AuthMiddleware.js');

vi.mock('../../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

import { handleStartAccountExport, handleGetAccountExportStatus } from './export.js';
import { JobType } from '@tzurot/common-types/constants/queue';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { stubRouteResolvers } from '../../../test/shared-route-test-utils.js';

const mockTxExportJob = {
  findFirst: vi.fn().mockResolvedValue(null),
  upsert: vi.fn().mockResolvedValue({ id: 'export-job-123' }),
};

const mockPrisma = {
  exportJob: {
    findFirst: vi.fn().mockResolvedValue(null),
  },
  $transaction: vi.fn().mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
    return callback({ exportJob: mockTxExportJob });
  }),
};

const mockQueue = {
  add: vi.fn().mockResolvedValue({ id: 'bullmq-job-id' }),
};

function createMockReqRes(body: Record<string, unknown> = {}) {
  const req = {
    body,
    query: {},
    userId: 'discord-user-123',
    provisionedUserId: 'user-uuid-123',
    provisionedDefaultPersonaId: 'persona-uuid-default',
  } as unknown as Request & { userId: string };

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  return { req, res };
}

describe('Account Export Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTxExportJob.findFirst.mockResolvedValue(null);
    mockTxExportJob.upsert.mockResolvedValue({ id: 'export-job-123' });
    mockPrisma.exportJob.findFirst.mockResolvedValue(null);
  });

  describe('POST /account/export', () => {
    async function callStart(body: Record<string, unknown> = {}) {
      const { req, res } = createMockReqRes(body);
      const handler = handleStartAccountExport({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
        aiQueue: mockQueue as never,
      });
      await handler(req, res, vi.fn());
      return { req, res };
    }

    it('503s when the job queue is not configured', async () => {
      const { req, res } = createMockReqRes({});
      const handler = handleStartAccountExport({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });
      await handler(req, res, vi.fn());
      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('creates the job row and enqueues the worker job with the provisioned user id', async () => {
      const { res } = await callStart();

      expect(res.status).toHaveBeenCalledWith(202);
      expect(mockTxExportJob.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            userId: 'user-uuid-123',
            sourceService: 'account',
            sourceSlug: 'account',
            format: 'zip',
            status: 'pending',
          }),
        })
      );
      const [jobType, jobData] = mockQueue.add.mock.calls[0];
      expect(jobType).toBe(JobType.AccountExport);
      expect(jobData).toEqual({
        userId: 'user-uuid-123',
        exportJobId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      });
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          status: 'pending',
          downloadUrl: expect.stringContaining('/exports/'),
        })
      );
    });

    it('409s while an account export is already active, without enqueueing', async () => {
      mockTxExportJob.findFirst.mockResolvedValueOnce({ status: 'in_progress' });
      const { res } = await callStart();

      expect(res.status).toHaveBeenCalledWith(409);
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('409s during the 24h cooldown after a completed export, without resetting the row', async () => {
      mockTxExportJob.findFirst
        .mockResolvedValueOnce(null) // no active job
        .mockResolvedValueOnce({ status: 'completed', completedAt: new Date() }); // recent completion
      const { res } = await callStart();

      expect(res.status).toHaveBeenCalledWith(409);
      expect(mockTxExportJob.upsert).not.toHaveBeenCalled();
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('cooldown query only counts completed jobs — failed runs are exempt by construction', async () => {
      await callStart();

      const cooldownWhere = mockTxExportJob.findFirst.mock.calls[1][0].where;
      expect(cooldownWhere.status).toBe('completed');
      expect(cooldownWhere.completedAt.gt).toBeInstanceOf(Date);
    });
  });

  describe('GET /account/export/status', () => {
    async function callStatus() {
      const { req, res } = createMockReqRes();
      const handler = handleGetAccountExportStatus({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });
      await handler(req, res, vi.fn());
      return { res };
    }

    it('returns null when the user never exported', async () => {
      const { res } = await callStatus();
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ job: null }));
    });

    it('adds a downloadUrl only for completed jobs', async () => {
      mockPrisma.exportJob.findFirst.mockResolvedValueOnce({
        id: 'job-1',
        status: 'completed',
        fileName: 'tzurot-account-export-alice-2026-07-15.zip',
        fileSizeBytes: 42,
        createdAt: new Date(),
        completedAt: new Date(),
        expiresAt: new Date(),
      });
      const first = await callStatus();
      expect(first.res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          job: expect.objectContaining({ downloadUrl: expect.stringContaining('/exports/job-1') }),
        })
      );

      mockPrisma.exportJob.findFirst.mockResolvedValueOnce({
        id: 'job-2',
        status: 'pending',
        fileName: null,
        fileSizeBytes: null,
        createdAt: new Date(),
        completedAt: null,
        expiresAt: new Date(),
      });
      const second = await callStatus();
      expect(second.res.json).toHaveBeenCalledWith(
        expect.objectContaining({ job: expect.objectContaining({ downloadUrl: null }) })
      );
    });
  });
});
