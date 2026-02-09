/**
 * Cache Invalidation Route Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { createInvalidateCacheRoute } from './invalidateCache.js';

// Mock AuthMiddleware
vi.mock('../../services/AuthMiddleware.js', () => ({
  requireOwnerAuth: () => (_req: unknown, _res: unknown, next: () => void) => {
    next(); // Bypass auth for testing
  },
}));

// Create mock CacheInvalidationService
const createMockCacheInvalidationService = () => ({
  invalidatePersonality: vi.fn().mockResolvedValue(undefined),
  invalidateAll: vi.fn().mockResolvedValue(undefined),
  publish: vi.fn().mockResolvedValue(undefined),
  subscribe: vi.fn().mockResolvedValue(undefined),
  unsubscribe: vi.fn().mockResolvedValue(undefined),
});

describe('POST /admin/invalidate-cache', () => {
  let app: Express;
  let cacheInvalidationService: ReturnType<typeof createMockCacheInvalidationService>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock cache invalidation service
    cacheInvalidationService = createMockCacheInvalidationService();

    // Create Express app with invalidate cache router
    app = express();
    app.use(express.json());
    app.use('/admin/invalidate-cache', createInvalidateCacheRoute(cacheInvalidationService as any));
  });

  it('should invalidate specific personality cache', async () => {
    const personalityId = '00000000-0000-4000-8000-000000000123';
    const response = await request(app).post('/admin/invalidate-cache').send({
      personalityId,
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.invalidated).toBe(personalityId);
    expect(cacheInvalidationService.invalidatePersonality).toHaveBeenCalledWith(personalityId);
    expect(cacheInvalidationService.invalidateAll).not.toHaveBeenCalled();
  });

  it('should invalidate all personality caches when all=true', async () => {
    const response = await request(app).post('/admin/invalidate-cache').send({
      all: true,
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.invalidated).toBe('all');
    expect(cacheInvalidationService.invalidateAll).toHaveBeenCalled();
    expect(cacheInvalidationService.invalidatePersonality).not.toHaveBeenCalled();
  });

  it('should reject request with neither personalityId nor all', async () => {
    const response = await request(app).post('/admin/invalidate-cache').send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
    expect(cacheInvalidationService.invalidatePersonality).not.toHaveBeenCalled();
    expect(cacheInvalidationService.invalidateAll).not.toHaveBeenCalled();
  });

  it('should reject request with empty personalityId', async () => {
    const response = await request(app).post('/admin/invalidate-cache').send({
      personalityId: '',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
    expect(cacheInvalidationService.invalidatePersonality).not.toHaveBeenCalled();
    expect(cacheInvalidationService.invalidateAll).not.toHaveBeenCalled();
  });
});
