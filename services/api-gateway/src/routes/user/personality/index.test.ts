/**
 * Tests for personality route composition (index.ts)
 *
 * These tests verify that all routes are properly registered on the router.
 * Handler-specific tests are in separate files matching the handler structure.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types';
import { createMockPrisma } from './test-utils.js';

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

vi.mock('../../../services/AuthMiddleware.js', () => ({
  requireUserAuth: vi.fn(() => vi.fn((_req: unknown, _res: unknown, next: () => void) => next())),
}));

vi.mock('../../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

import { createPersonalityRoutes } from './index.js';

describe('/user/personality route composition', () => {
  const mockPrisma = createMockPrisma();

  describe('route factory', () => {
    it('should create a router', () => {
      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);

      expect(router).toBeDefined();
      expect(typeof router).toBe('function');
    });

    it('should have GET / route registered', () => {
      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);

      expect(router.stack).toBeDefined();
      expect(router.stack.length).toBeGreaterThan(0);

      const getRoute = (
        router.stack as unknown as { route?: { path?: string; methods?: { get?: boolean } } }[]
      ).find(layer => layer.route?.path === '/' && layer.route?.methods?.get);
      expect(getRoute).toBeDefined();
    });

    it('should have GET /:slug route registered', () => {
      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);

      const getRoute = (
        router.stack as unknown as { route?: { path?: string; methods?: { get?: boolean } } }[]
      ).find(layer => layer.route?.path === '/:slug' && layer.route?.methods?.get);
      expect(getRoute).toBeDefined();
    });

    it('should have POST / route registered', () => {
      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);

      const postRoute = (
        router.stack as unknown as { route?: { path?: string; methods?: { post?: boolean } } }[]
      ).find(layer => layer.route?.path === '/' && layer.route?.methods?.post);
      expect(postRoute).toBeDefined();
    });

    it('should have PUT /:slug route registered', () => {
      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);

      const putRoute = (
        router.stack as unknown as { route?: { path?: string; methods?: { put?: boolean } } }[]
      ).find(layer => layer.route?.path === '/:slug' && layer.route?.methods?.put);
      expect(putRoute).toBeDefined();
    });

    it('should have PATCH /:slug/visibility route registered', () => {
      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);

      const patchRoute = (
        router.stack as unknown as { route?: { path?: string; methods?: { patch?: boolean } } }[]
      ).find(layer => layer.route?.path === '/:slug/visibility' && layer.route?.methods?.patch);
      expect(patchRoute).toBeDefined();
    });

    it('should have DELETE /:slug route registered', () => {
      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);

      const deleteRoute = (
        router.stack as unknown as { route?: { path?: string; methods?: { delete?: boolean } } }[]
      ).find(layer => layer.route?.path === '/:slug' && layer.route?.methods?.delete);
      expect(deleteRoute).toBeDefined();
    });
  });
});
