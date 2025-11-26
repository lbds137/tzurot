/**
 * Tests for /user/llm-config routes
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
    create: vi.fn(),
  },
  llmConfig: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
  userPersonalityConfig: {
    count: vi.fn(),
  },
};

import { createLlmConfigRoutes } from './llm-config.js';
import type { PrismaClient } from '@tzurot/common-types';

describe('/user/llm-config routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('route factory', () => {
    it('should create a router', () => {
      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);

      expect(router).toBeDefined();
      expect(typeof router).toBe('function');
    });

    it('should have GET route registered', () => {
      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);

      expect(router.stack).toBeDefined();
      expect(router.stack.length).toBeGreaterThan(0);

      const getRoute = (
        router.stack as unknown as Array<{ route?: { path?: string; methods?: { get?: boolean } } }>
      ).find(layer => layer.route?.path === '/' && layer.route?.methods?.get);
      expect(getRoute).toBeDefined();
    });

    it('should have POST route registered', () => {
      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);

      const postRoute = (
        router.stack as unknown as Array<{
          route?: { path?: string; methods?: { post?: boolean } };
        }>
      ).find(layer => layer.route?.path === '/' && layer.route?.methods?.post);
      expect(postRoute).toBeDefined();
    });

    it('should have DELETE route registered', () => {
      const router = createLlmConfigRoutes(mockPrisma as unknown as PrismaClient);

      const deleteRoute = (
        router.stack as unknown as Array<{
          route?: { path?: string; methods?: { delete?: boolean } };
        }>
      ).find(layer => layer.route?.path === '/:id' && layer.route?.methods?.delete);
      expect(deleteRoute).toBeDefined();
    });
  });
});
