/**
 * Confirm Delivery Route Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { createConfirmDeliveryRoute } from './confirmDelivery.js';
import type { PrismaClient } from '@tzurot/common-types';

// Create mock Prisma client
const createMockPrismaClient = () => ({
  jobResult: {
    updateMany: vi.fn(),
    findUnique: vi.fn(),
  },
});

describe('POST /job/:jobId/confirm-delivery', () => {
  let app: Express;
  let prisma: ReturnType<typeof createMockPrismaClient>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock Prisma client
    prisma = createMockPrismaClient();

    // Create Express app with confirm delivery router
    app = express();
    app.use(express.json());
    app.use('/', createConfirmDeliveryRoute(prisma as unknown as PrismaClient));
  });

  it('should confirm job delivery', async () => {
    prisma.jobResult.updateMany.mockResolvedValue({ count: 1 });

    const response = await request(app).post('/job/llm-req-123/confirm-delivery');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      jobId: 'llm-req-123',
      status: 'DELIVERED',
    });
    expect(prisma.jobResult.updateMany).toHaveBeenCalledWith({
      where: {
        jobId: 'llm-req-123',
        status: 'PENDING_DELIVERY',
      },
      data: {
        status: 'DELIVERED',
        deliveredAt: expect.any(Date),
      },
    });
  });

  it('should handle already delivered jobs idempotently', async () => {
    prisma.jobResult.updateMany.mockResolvedValue({ count: 0 });
    prisma.jobResult.findUnique.mockResolvedValue({
      jobId: 'llm-req-123',
      status: 'DELIVERED',
    } as never);

    const response = await request(app).post('/job/llm-req-123/confirm-delivery');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      jobId: 'llm-req-123',
      status: 'DELIVERED',
      message: 'Already confirmed',
    });
  });

  it('should return 404 when job does not exist', async () => {
    prisma.jobResult.updateMany.mockResolvedValue({ count: 0 });
    prisma.jobResult.findUnique.mockResolvedValue(null);

    const response = await request(app).post('/job/nonexistent/confirm-delivery');

    expect(response.status).toBe(404);
    expect(response.body.error).toBeDefined();
  });
});
