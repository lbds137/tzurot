/**
 * Integration Test: AI Routes
 *
 * Tests the four AI route handlers:
 * - generate (AI generation)
 * - transcribe (audio transcription)
 * - jobStatus (job status checking)
 * - confirmDelivery (delivery confirmation)
 *
 * Handlers are registered here at their production paths (mirroring the
 * codegen mounts); the conformance suite is what verifies the generated
 * wiring itself. Focus: handler behavior — validation, method handling,
 * error shapes.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import type { Queue, QueueEvents } from 'bullmq';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { stubRouteResolvers } from '../../test/shared-route-test-utils.js';
import {
  createTestPGlite,
  setupTestEnvironment,
  loadPGliteSchema,
  type TestEnvironment,
} from '@tzurot/test-utils';

// Mock the queue module to prevent BullMQ from trying to connect to Redis
vi.mock('../../queue.js', () => ({
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
  closeQueue: vi.fn().mockResolvedValue(undefined),
  checkQueueHealth: vi.fn().mockResolvedValue(true),
}));

// Mock deduplication cache singleton
vi.mock('../../utils/deduplicationCache.js', () => ({
  deduplicationCache: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  },
}));

// Import after mocking
const { handleAiGenerate } = await import('./generate.js');
const { handleAiTranscribe } = await import('./transcribe.js');
const { handleAiJobStatus } = await import('./jobStatus.js');
const { handleAiConfirmDelivery } = await import('./confirmDelivery.js');

describe('AI Routes Integration', () => {
  let testEnv: TestEnvironment;
  let app: Express;
  let pglite: PGlite;
  let prisma: PrismaClient;

  beforeAll(async () => {
    testEnv = await setupTestEnvironment();

    // Set up PGLite with Prisma
    pglite = createTestPGlite();
    await pglite.exec(loadPGliteSchema());
    const adapter = new PrismaPGlite(pglite);
    prisma = new PrismaClient({ adapter }) as PrismaClient;

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

    // Register the four handlers at their production paths (mirrors
    // routes/_generated/mounts.ts — the sole live mount since the legacy
    // bare /ai/* dual-mount was retired)
    const deps = {
      ...stubRouteResolvers(),
      prisma,
      aiQueue: mockQueue,
      queueEvents: mockQueueEvents,
    };
    app.post('/api/internal/ai/generate', handleAiGenerate(deps));
    app.post('/api/internal/ai/transcribe', handleAiTranscribe(deps));
    app.get('/api/internal/ai/job/:jobId', handleAiJobStatus(deps));
    app.post('/api/internal/ai/job/:jobId/confirm-delivery', handleAiConfirmDelivery(deps));
  }, 30000);

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
    await testEnv.cleanup();
  });

  describe('route registration', () => {
    it('should have generate route registered', async () => {
      const response = await request(app).post('/api/internal/ai/generate');

      // Route exists (not 404)
      expect(response.status).not.toBe(404);
    });

    it('should have transcribe route registered', async () => {
      const response = await request(app).post('/api/internal/ai/transcribe');

      // Route exists (not 404)
      expect(response.status).not.toBe(404);
    });

    it('should have job status route registered', async () => {
      const response = await request(app).get('/api/internal/ai/job/test-job-id');

      // Route exists (not 404)
      expect(response.status).not.toBe(404);
    });

    it('should have confirm delivery route registered', async () => {
      // Note: Route IS registered, but returns 404 from job lookup
      // This is expected behavior - route exists, job doesn't
      const response = await request(app).post('/api/internal/ai/job/test-job-id/confirm-delivery');

      // Route processes request (not 405 "method not allowed")
      expect(response.status).not.toBe(405);
    });
  });

  describe('generate route', () => {
    it('should reject requests without required fields', async () => {
      const response = await request(app).post('/api/internal/ai/generate').send({});

      // Should return 400 (validation error)
      expect(response.status).toBe(400);
    });

    it('should reject requests with invalid requestId', async () => {
      const response = await request(app).post('/api/internal/ai/generate').send({
        requestId: 123, // Should be string
      });

      // Should return 400 (validation error)
      expect(response.status).toBe(400);
    });

    it('should reject requests missing personalityName', async () => {
      const response = await request(app).post('/api/internal/ai/generate').send({
        requestId: 'test-request-id',
        messages: [],
      });

      // Should return 400 (missing personalityName)
      expect(response.status).toBe(400);
    });

    it('should reject requests with invalid messages format', async () => {
      const response = await request(app).post('/api/internal/ai/generate').send({
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
      const response = await request(app).post('/api/internal/ai/transcribe').send({});

      // Should return 400 (validation error)
      expect(response.status).toBe(400);
    });

    it('should reject requests with invalid audioUrl', async () => {
      const response = await request(app).post('/api/internal/ai/transcribe').send({
        requestId: 'test-request-id',
        audioUrl: 123, // Should be string
      });

      // Should return 400 (validation error)
      expect(response.status).toBe(400);
    });
  });

  describe('job status route', () => {
    it('should accept GET requests with job ID', async () => {
      const response = await request(app).get('/api/internal/ai/job/test-job-id');

      // Should not be 404 or 405
      expect(response.status).not.toBe(404);
      expect(response.status).not.toBe(405);
    });

    it('should reject POST requests', async () => {
      const response = await request(app).post('/api/internal/ai/job/test-job-id');

      // Should return 404 or 405 (method not allowed)
      expect([404, 405]).toContain(response.status);
    });
  });

  describe('confirm delivery route', () => {
    it('should handle POST requests with jobId', async () => {
      // Actual path is /job/:jobId/confirm-delivery
      const response = await request(app)
        .post('/api/internal/ai/job/test-job-id/confirm-delivery')
        .send({});

      // Route processes request (not 405 "method not allowed")
      // May return 404 for non-existent job, which is valid behavior
      expect(response.status).not.toBe(405);
    });
  });

  describe('request/response format', () => {
    it('should return JSON responses for validation errors', async () => {
      const response = await request(app).post('/api/internal/ai/generate').send({});

      // Should have JSON content-type
      expect(response.headers['content-type']).toMatch(/json/);
    });

    it('should handle JSON parse errors gracefully', async () => {
      const response = await request(app)
        .post('/api/internal/ai/generate')
        .set('Content-Type', 'application/json')
        .send('invalid json{');

      // Should return 400 (bad request)
      expect([400, 500]).toContain(response.status);
    });
  });

  describe('HTTP method validation', () => {
    it('should reject GET on POST-only generate route', async () => {
      const response = await request(app).get('/api/internal/ai/generate');

      // Should return 404 or 405 (method not allowed)
      expect([404, 405]).toContain(response.status);
    });

    it('should reject DELETE on AI routes', async () => {
      const response = await request(app).delete('/api/internal/ai/generate');

      // Should return 404 or 405 (method not allowed)
      expect([404, 405]).toContain(response.status);
    });
  });

  describe('error handling', () => {
    it('should handle malformed JSON', async () => {
      const response = await request(app)
        .post('/api/internal/ai/generate')
        .set('Content-Type', 'application/json')
        .send('{invalid}');

      // Should return 400 or 500
      expect([400, 500]).toContain(response.status);
    });

    it('should handle empty body', async () => {
      const response = await request(app).post('/api/internal/ai/generate').send();

      // Should return 400 (validation error)
      expect(response.status).toBe(400);
    });
  });
});
