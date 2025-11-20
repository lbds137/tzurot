/**
 * Job Status Route Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { createJobStatusRoute } from './jobStatus.js';
import type { Queue, Job } from 'bullmq';

// Create mock BullMQ queue
const createMockQueue = () => ({
  add: vi.fn(),
  getJob: vi.fn(),
  getWaitingCount: vi.fn().mockResolvedValue(0),
  getActiveCount: vi.fn().mockResolvedValue(0),
  getCompletedCount: vi.fn().mockResolvedValue(0),
  getFailedCount: vi.fn().mockResolvedValue(0),
});

describe('GET /job/:jobId', () => {
  let app: Express;
  let aiQueue: ReturnType<typeof createMockQueue>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mocks
    aiQueue = createMockQueue();

    // Create Express app with job status router
    app = express();
    app.use(express.json());
    app.use('/', createJobStatusRoute(aiQueue as unknown as Queue));
  });

  it('should return job status', async () => {
    const mockJob = {
      id: 'llm-req-123',
      getState: vi.fn().mockResolvedValue('completed'),
      progress: 100,
      returnvalue: { response: 'Hello there!' },
    } as unknown as Job;
    aiQueue.getJob.mockResolvedValue(mockJob);

    const response = await request(app).get('/job/llm-req-123');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      jobId: 'llm-req-123',
      status: 'completed',
      progress: 100,
    });
  });

  it('should return 404 when job does not exist', async () => {
    aiQueue.getJob.mockResolvedValue(undefined);

    const response = await request(app).get('/job/nonexistent');

    expect(response.status).toBe(404);
    expect(response.body.error).toBeDefined();
  });
});
