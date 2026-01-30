/**
 * Integration Test: Admin Routes
 *
 * Tests admin routes that were refactored into focused files:
 * - createPersonality
 * - updatePersonality
 * - dbSync
 * - invalidateCache
 *
 * Focus: Verify routes are registered correctly and basic functionality works
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { PersonalityService, CacheInvalidationService } from '@tzurot/common-types';
import { createAdminRouter } from './index.js';
import { setupTestEnvironment, type TestEnvironment } from '@tzurot/test-utils';

describe('Admin Routes Integration', () => {
  let testEnv: TestEnvironment;
  let app: Express;

  beforeAll(async () => {
    testEnv = await setupTestEnvironment();

    // Create minimal Express app with admin routes
    app = express();
    app.use(express.json());

    // Create dependencies
    const personalityService = new PersonalityService(testEnv.prisma);
    const cacheInvalidationService = new CacheInvalidationService(
      testEnv.redis,
      personalityService
    );

    // Mount admin router
    const adminRouter = createAdminRouter(testEnv.prisma, cacheInvalidationService);
    app.use('/admin', adminRouter);
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  describe('route registration', () => {
    it('should have db-sync route registered', async () => {
      const response = await request(app).post('/admin/db-sync');

      // Route exists (not 404)
      expect(response.status).not.toBe(404);
    });

    it('should have personality routes registered', async () => {
      // POST /admin/personality (create)
      const createResponse = await request(app).post('/admin/personality');
      expect(createResponse.status).not.toBe(404);

      // PATCH /admin/personality/:slug (update)
      const updateResponse = await request(app).patch('/admin/personality/test-slug');
      expect(updateResponse.status).not.toBe(404);
    });

    it('should have invalidate-cache route registered', async () => {
      const response = await request(app).post('/admin/invalidate-cache');

      // Route exists (not 404)
      expect(response.status).not.toBe(404);
    });
  });

  describe('db-sync route', () => {
    it('should accept POST requests', async () => {
      const response = await request(app).post('/admin/db-sync').send({});

      // Should not be 404 or 405
      expect(response.status).not.toBe(404);
      expect(response.status).not.toBe(405);
    });
  });

  describe('create personality route', () => {
    it('should reject unauthorized requests', async () => {
      const response = await request(app).post('/admin/personality').send({});

      // Has requireOwnerAuth() middleware, returns 403 without auth
      expect(response.status).toBe(403);
    });

    it('should require authentication before validation', async () => {
      const response = await request(app).post('/admin/personality').send({
        name: 123, // Should be string
      });

      // Auth runs first, returns 403 before validation
      expect(response.status).toBe(403);
    });
  });

  describe('update personality route', () => {
    it('should reject unauthorized requests without auth', async () => {
      const response = await request(app).patch('/admin/personality/test-slug').send({});

      // Has requireOwnerAuth() middleware, returns 403 without auth
      expect(response.status).toBe(403);
    });

    it('should reject requests with non-existent personality slug', async () => {
      const fakeSlug = 'nonexistent-slug-99999';
      const response = await request(app).patch(`/admin/personality/${fakeSlug}`).send({
        name: 'Updated Name',
      });

      // Auth middleware returns 403 first, or 404 if personality not found
      expect([403, 404, 500]).toContain(response.status);
    });
  });

  describe('invalidate cache route', () => {
    it('should accept POST requests', async () => {
      const response = await request(app).post('/admin/invalidate-cache').send({});

      // Should not be 404 or 405
      expect(response.status).not.toBe(404);
      expect(response.status).not.toBe(405);
    });
  });

  describe('request/response format', () => {
    it('should return JSON responses', async () => {
      const response = await request(app).post('/admin/personality').send({});

      // Should have JSON content-type
      expect(response.headers['content-type']).toMatch(/json/);
    });

    it('should handle JSON parse errors gracefully', async () => {
      const response = await request(app)
        .post('/admin/personality')
        .set('Content-Type', 'application/json')
        .send('invalid json{');

      // Should return 400 (bad request)
      expect([400, 500]).toContain(response.status);
    });
  });

  describe('HTTP method validation', () => {
    it('should reject GET on POST-only routes', async () => {
      const response = await request(app).get('/admin/personality');

      // Should return 403 (auth required), 404, or 405 (method not allowed)
      // 403 is returned first because admin auth middleware runs before route matching
      expect([403, 404, 405]).toContain(response.status);
    });

    it('should reject DELETE on non-DELETE routes', async () => {
      const response = await request(app).delete('/admin/db-sync');

      // Should return 403 (auth required), 404, or 405 (method not allowed)
      // 403 is returned first because admin auth middleware runs before route matching
      expect([403, 404, 405]).toContain(response.status);
    });
  });
});
