/**
 * Tests for GET /wallet/list route
 *
 * These tests verify the route factory creates a properly configured router.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
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
  },
  userApiKey: {
    findMany: vi.fn(),
  },
};

import { createListKeysRoute } from './listKeys.js';
import type { PrismaClient } from '@tzurot/common-types';

describe('GET /wallet/list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('route factory', () => {
    it('should create a router', () => {
      const router = createListKeysRoute(mockPrisma as unknown as PrismaClient);

      expect(router).toBeDefined();
      expect(typeof router).toBe('function');
    });

    it('should have a GET route registered', () => {
      const router = createListKeysRoute(mockPrisma as unknown as PrismaClient);

      expect(router.stack).toBeDefined();
      expect(router.stack.length).toBeGreaterThan(0);

      // Find the GET route - use type assertion for Express internals
      const getRoute = (
        router.stack as unknown as Array<{ route?: { methods?: { get?: boolean } } }>
      ).find(layer => layer.route?.methods?.get);
      expect(getRoute).toBeDefined();
    });
  });
});
