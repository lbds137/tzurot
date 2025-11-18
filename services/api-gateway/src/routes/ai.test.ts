/**
 * AI Routes Tests
 * Tests for AI generation and job management endpoints
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { createAIRouter } from './ai.js';
import type { PrismaClient } from '@prisma/client';
import type { Queue, QueueEvents, Job } from 'bullmq';
import { JobStatus } from '@tzurot/common-types';
import type { AttachmentStorageService } from '../services/AttachmentStorageService.js';

// Mock dependencies
vi.mock('../utils/requestDeduplication.js', () => ({
  checkDuplicate: vi.fn().mockReturnValue(null),
  cacheRequest: vi.fn(),
}));
vi.mock('../utils/jobChainOrchestrator.js', () => ({
  createJobChain: vi.fn().mockResolvedValue('llm-req-123'),
}));

// Create mock Prisma client
const createMockPrismaClient = () => ({
  jobResult: {
    updateMany: vi.fn(),
    findUnique: vi.fn(),
  },
});

// Create mock BullMQ queue
const createMockQueue = () => ({
  add: vi.fn(),
  getJob: vi.fn(),
  getWaitingCount: vi.fn().mockResolvedValue(0),
  getActiveCount: vi.fn().mockResolvedValue(0),
  getCompletedCount: vi.fn().mockResolvedValue(0),
  getFailedCount: vi.fn().mockResolvedValue(0),
});

// Create mock QueueEvents
const createMockQueueEvents = () => ({
  on: vi.fn(),
  off: vi.fn(),
});

// Create mock AttachmentStorageService
const createMockAttachmentStorage = () => ({
  downloadAndStore: vi.fn().mockImplementation(async (_requestId, attachments) => attachments),
  cleanup: vi.fn().mockResolvedValue(undefined),
});

describe('AI Routes', () => {
  let app: Express;
  let prisma: ReturnType<typeof createMockPrismaClient>;
  let aiQueue: ReturnType<typeof createMockQueue>;
  let queueEvents: ReturnType<typeof createMockQueueEvents>;
  let attachmentStorage: ReturnType<typeof createMockAttachmentStorage>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mocks
    prisma = createMockPrismaClient();
    aiQueue = createMockQueue();
    queueEvents = createMockQueueEvents();
    attachmentStorage = createMockAttachmentStorage();

    // Create Express app with AI router
    app = express();
    app.use(express.json());
    app.use(
      '/ai',
      createAIRouter(
        prisma as unknown as PrismaClient,
        aiQueue as unknown as Queue,
        queueEvents as unknown as QueueEvents,
        attachmentStorage as unknown as AttachmentStorageService
      )
    );
  });

  describe('POST /ai/generate', () => {
    it('should create a job and return 202 Accepted', async () => {
      const response = await request(app)
        .post('/ai/generate')
        .send({
          personality: {
            id: 'personality-123',
            name: 'TestBot',
            displayName: 'Test Bot',
            slug: 'test-bot',
            systemPrompt: 'You are a helpful assistant',
            model: 'anthropic/claude-sonnet-4.5',
            temperature: 0.7,
            maxTokens: 4096,
            contextWindowTokens: 200000,
            characterInfo: 'A helpful assistant',
            personalityTraits: 'Friendly and knowledgeable',
          },
          message: 'Hello!',
          context: {
            userId: 'user-123',
            channelId: 'channel-123',
          },
        });

      expect(response.status).toBe(202);
      expect(response.body).toMatchObject({
        jobId: 'llm-req-123',
        status: JobStatus.Queued,
      });
      expect(response.body.requestId).toBeDefined();
    });

    it('should reject invalid request body', async () => {
      const response = await request(app)
        .post('/ai/generate')
        .send({
          // Missing required fields
          message: 'Hello!',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('POST /ai/transcribe', () => {
    it('should create transcription job and return job ID', async () => {
      const mockJob = {
        id: 'audio-req-123',
      } as Job;
      aiQueue.add.mockResolvedValue(mockJob);

      const response = await request(app)
        .post('/ai/transcribe')
        .send({
          attachments: [
            {
              url: 'https://example.com/audio.ogg',
              contentType: 'audio/ogg',
              name: 'audio.ogg',
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        jobId: 'audio-req-123',
        status: JobStatus.Queued,
      });
      expect(aiQueue.add).toHaveBeenCalled();
    });

    it('should reject request without attachments', async () => {
      const response = await request(app)
        .post('/ai/transcribe')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('GET /ai/job/:jobId', () => {
    it('should return job status', async () => {
      const mockJob = {
        id: 'llm-req-123',
        getState: vi.fn().mockResolvedValue('completed'),
        progress: 100,
        returnvalue: { response: 'Hello there!' },
      } as unknown as Job;
      aiQueue.getJob.mockResolvedValue(mockJob);

      const response = await request(app).get('/ai/job/llm-req-123');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        jobId: 'llm-req-123',
        status: 'completed',
        progress: 100,
      });
    });

    it('should return 404 when job does not exist', async () => {
      aiQueue.getJob.mockResolvedValue(undefined);

      const response = await request(app).get('/ai/job/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('POST /ai/job/:jobId/confirm-delivery', () => {
    it('should confirm job delivery', async () => {
      prisma.jobResult.updateMany.mockResolvedValue({ count: 1 });

      const response = await request(app).post('/ai/job/llm-req-123/confirm-delivery');

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

      const response = await request(app).post('/ai/job/llm-req-123/confirm-delivery');

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

      const response = await request(app).post('/ai/job/nonexistent/confirm-delivery');

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
    });
  });
});
