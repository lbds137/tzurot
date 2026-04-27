import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { PrismaClient } from '@tzurot/common-types';
import { createInternalRouter } from './index.js';

vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

/**
 * Note: service-auth (`requireServiceAuth()`) is applied globally in
 * `services/api-gateway/src/index.ts` before the `/internal` mount, not
 * per-router. These tests construct a bare express app to verify routing
 * structure only — auth gating is covered by AuthMiddleware.test.ts and
 * the integration tests, not here.
 */
describe('createInternalRouter', () => {
  let mockPrisma: { $queryRaw: ReturnType<typeof vi.fn> };
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = { $queryRaw: vi.fn().mockResolvedValue([]) };
    app = express();
    app.use('/internal', createInternalRouter(mockPrisma as unknown as PrismaClient));
  });

  it('mounts GET /users/recent', async () => {
    const response = await request(app).get('/internal/users/recent');
    expect(response.status).toBe(200);
    expect(mockPrisma.$queryRaw).toHaveBeenCalled();
  });

  it('returns 404 for unknown internal routes', async () => {
    const response = await request(app).get('/internal/does-not-exist');
    expect(response.status).toBe(404);
  });
});
