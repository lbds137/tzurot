/**
 * Tests for /user/timezone routes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before imports
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

vi.mock('../../services/AuthMiddleware.js', () => ({
  requireUserAuth: vi.fn(() => vi.fn((_req: unknown, _res: unknown, next: () => void) => next())),
}));

vi.mock('../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

// Mock Prisma
const mockPrisma = {
  user: {
    findFirst: vi.fn(),
    upsert: vi.fn(),
  },
};

import { createTimezoneRoutes } from './timezone.js';
import type { PrismaClient } from '@tzurot/common-types';

describe('/user/timezone routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('route factory', () => {
    it('should create a router', () => {
      const router = createTimezoneRoutes(mockPrisma as unknown as PrismaClient);

      expect(router).toBeDefined();
      expect(typeof router).toBe('function');
    });

    it('should have GET route registered', () => {
      const router = createTimezoneRoutes(mockPrisma as unknown as PrismaClient);

      expect(router.stack).toBeDefined();
      expect(router.stack.length).toBeGreaterThan(0);

      const getRoute = (
        router.stack as unknown as Array<{ route?: { path?: string; methods?: { get?: boolean } } }>
      ).find(layer => layer.route?.path === '/' && layer.route?.methods?.get);
      expect(getRoute).toBeDefined();
    });

    it('should have PUT route registered', () => {
      const router = createTimezoneRoutes(mockPrisma as unknown as PrismaClient);

      const putRoute = (
        router.stack as unknown as Array<{ route?: { path?: string; methods?: { put?: boolean } } }>
      ).find(layer => layer.route?.path === '/' && layer.route?.methods?.put);
      expect(putRoute).toBeDefined();
    });
  });
});
