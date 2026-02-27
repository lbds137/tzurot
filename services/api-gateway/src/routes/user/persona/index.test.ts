/**
 * Tests for persona route factory
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

import { createPersonaRoutes } from './index.js';

describe('createPersonaRoutes', () => {
  const mockPrisma = createMockPrisma();

  it('should create a router', () => {
    const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);

    expect(router).toBeDefined();
    expect(typeof router).toBe('function');
  });

  it('should have GET / route registered', () => {
    const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);

    const getRoute = (
      router.stack as unknown as Array<{ route?: { path?: string; methods?: { get?: boolean } } }>
    ).find(layer => layer.route?.path === '/' && layer.route?.methods?.get);
    expect(getRoute).toBeDefined();
  });

  it('should have POST / route registered', () => {
    const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);

    const postRoute = (
      router.stack as unknown as Array<{ route?: { path?: string; methods?: { post?: boolean } } }>
    ).find(layer => layer.route?.path === '/' && layer.route?.methods?.post);
    expect(postRoute).toBeDefined();
  });

  it('should have override routes registered', () => {
    const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);

    const overrideRoute = (
      router.stack as unknown as Array<{ route?: { path?: string; methods?: { get?: boolean } } }>
    ).find(layer => layer.route?.path === '/override' && layer.route?.methods?.get);
    expect(overrideRoute).toBeDefined();
  });

  it('should have default route registered', () => {
    const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);

    const defaultRoute = (
      router.stack as unknown as Array<{
        route?: { path?: string; methods?: { patch?: boolean } };
      }>
    ).find(layer => layer.route?.path === '/:id/default' && layer.route?.methods?.patch);
    expect(defaultRoute).toBeDefined();
  });
});
