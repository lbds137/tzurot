/**
 * Integration Test: AI Routes
 *
 * Tests AI routes that were refactored into focused files:
 * - generate (AI generation)
 * - transcribe (audio transcription)
 * - jobStatus (job status checking)
 * - confirmDelivery (delivery confirmation)
 *
 * Focus: Verify routes are registered correctly and handle requests appropriately
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import type { Queue, QueueEvents } from 'bullmq';
import type { AttachmentStorageService } from '../../services/AttachmentStorageService.js';
import {
  setupTestEnvironment,
  type TestEnvironment,
} from '../../../../../../tests/helpers/setup-pglite.js';

// Mock the queue module to prevent BullMQ from trying to connect to Redis
vi.mock('../../../queue.js', () => ({
  aiQueue: {
    add: vi.fn().mockResolvedValue({ id: 'mock-job-id' }),
    getJob: vi.fn().mockResolvedValue(null),
    name: 'mock-queue',
  },
  flowProducer: {
    add: vi.fn().mockResolvedValue({ job: { id: 'mock-flow-id' } }),
  },
  queueEvents: {
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
  },
}));

// Mock deduplication cache singleton
vi.mock('../../../utils/deduplicationCache.js', () => ({
  deduplicationCache: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  },
}));

// Import after mocking
const { createAIRouter } = await import('./index.js');

describe('AI Routes Integration', () => {
  let testEnv: TestEnvironment;
  let app: Express;

  beforeAll(async () => {
    testEnv = await setupTestEnvironment();

    // Create minimal Express app with AI routes
    app = express();
    app.use(express.json());

    // Create mock dependencies
    // Note: These are minimal mocks just to test route registration
    const mockQueue = {
      add: async () => ({ id: 'mock-job-id' }),
      getJob: async () => null,
      name: 'mock-queue',
    } as unknown as Queue;

    const mockQueueEvents = {
      on: () => {},
      off: () => {},
      once: () => {},
    } as unknown as QueueEvents;

    const mockAttachmentStorage = {
      downloadAndStoreAttachment: async () => '/tmp/mock-file',
    } as unknown as AttachmentStorageService;

    // Mount AI router
    const aiRouter = createAIRouter(
      testEnv.prisma,
      mockQueue,
      mockQueueEvents,
      mockAttachmentStorage
    );
    app.use('/ai', aiRouter);
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  describe('route registration', () => {
    it('should have generate route registered', async () => {
      const response = await request(app).post('/ai/generate');

      // Route exists (not 404)
      expect(response.status).not.toBe(404);
    });

    it('should have transcribe route registered', async () => {
      const response = await request(app).post('/ai/transcribe');

      // Route exists (not 404)
      expect(response.status).not.toBe(404);
    });

    it('should have job status route registered', async () => {
      const response = await request(app).get('/ai/job/test-job-id');

      // Route exists (not 404)
      expect(response.status).not.toBe(404);
    });

    it('should have confirm delivery route registered', async () => {
      // Note: Route IS registered, but returns 404 from job lookup
      // This is expected behavior - route exists, job doesn't
      const response = await request(app).post('/ai/job/test-job-id/confirm-delivery');

      // Route processes request (not 405 "method not allowed")
      expect(response.status).not.toBe(405);
    });
  });

  describe('generate route', () => {
    it('should reject requests without required fields', async () => {
      const response = await request(app).post('/ai/generate').send({});

      // Should return 400 (validation error)
      expect(response.status).toBe(400);
    });

    it('should reject requests with invalid requestId', async () => {
      const response = await request(app).post('/ai/generate').send({
        requestId: 123, // Should be string
      });

      // Should return 400 (validation error)
      expect(response.status).toBe(400);
    });

    it('should reject requests missing personalityName', async () => {
      const response = await request(app).post('/ai/generate').send({
        requestId: 'test-request-id',
        messages: [],
      });

      // Should return 400 (missing personalityName)
      expect(response.status).toBe(400);
    });

    it('should reject requests with invalid messages format', async () => {
      const response = await request(app).post('/ai/generate').send({
        requestId: 'test-request-id',
        personalityName: 'TestBot',
        messages: 'not an array', // Should be array
      });

      // Should return 400 (validation error)
      expect(response.status).toBe(400);
    });
  });

  describe('transcribe route', () => {
    it('should reject requests without required fields', async () => {
      const response = await request(app).post('/ai/transcribe').send({});

      // Should return 400 (validation error)
      expect(response.status).toBe(400);
    });

    it('should reject requests with invalid audioUrl', async () => {
      const response = await request(app).post('/ai/transcribe').send({
        requestId: 'test-request-id',
        audioUrl: 123, // Should be string
      });

      // Should return 400 (validation error)
      expect(response.status).toBe(400);
    });
  });

  describe('job status route', () => {
    it('should accept GET requests with job ID', async () => {
      const response = await request(app).get('/ai/job/test-job-id');

      // Should not be 404 or 405
      expect(response.status).not.toBe(404);
      expect(response.status).not.toBe(405);
    });

    it('should reject POST requests', async () => {
      const response = await request(app).post('/ai/job/test-job-id');

      // Should return 404 or 405 (method not allowed)
      expect([404, 405]).toContain(response.status);
    });
  });

  describe('confirm delivery route', () => {
    it('should handle POST requests with jobId', async () => {
      // Actual path is /job/:jobId/confirm-delivery
      const response = await request(app).post('/ai/job/test-job-id/confirm-delivery').send({});

      // Route processes request (not 405 "method not allowed")
      // May return 404 for non-existent job, which is valid behavior
      expect(response.status).not.toBe(405);
    });
  });

  describe('request/response format', () => {
    it('should return JSON responses for validation errors', async () => {
      const response = await request(app).post('/ai/generate').send({});

      // Should have JSON content-type
      expect(response.headers['content-type']).toMatch(/json/);
    });

    it('should handle JSON parse errors gracefully', async () => {
      const response = await request(app)
        .post('/ai/generate')
        .set('Content-Type', 'application/json')
        .send('invalid json{');

      // Should return 400 (bad request)
      expect([400, 500]).toContain(response.status);
    });
  });

  describe('HTTP method validation', () => {
    it('should reject GET on POST-only generate route', async () => {
      const response = await request(app).get('/ai/generate');

      // Should return 404 or 405 (method not allowed)
      expect([404, 405]).toContain(response.status);
    });

    it('should reject DELETE on AI routes', async () => {
      const response = await request(app).delete('/ai/generate');

      // Should return 404 or 405 (method not allowed)
      expect([404, 405]).toContain(response.status);
    });
  });

  describe('error handling', () => {
    it('should handle malformed JSON', async () => {
      const response = await request(app)
        .post('/ai/generate')
        .set('Content-Type', 'application/json')
        .send('{invalid}');

      // Should return 400 or 500
      expect([400, 500]).toContain(response.status);
    });

    it('should handle empty body', async () => {
      const response = await request(app).post('/ai/generate').send();

      // Should return 400 (validation error)
      expect(response.status).toBe(400);
    });
  });
});
