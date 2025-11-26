/**
 * Tests for POST /wallet/set route
 *
 * These tests verify the route factory creates a properly configured router.
 * The actual handler logic is tested via integration tests or by testing
 * the underlying service functions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIProvider } from '@tzurot/common-types';

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
    encryptApiKey: vi.fn().mockReturnValue({
      iv: 'mock-iv-12345678901234567890123456789012',
      content: 'mock-encrypted-content',
      tag: 'mock-tag-12345678901234567890123456',
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
  userApiKey: {
    upsert: vi.fn(),
  },
};

import { createSetKeyRoute } from './setKey.js';
import type { PrismaClient } from '@tzurot/common-types';

describe('POST /wallet/set', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('route factory', () => {
    it('should create a router', () => {
      const router = createSetKeyRoute(mockPrisma as unknown as PrismaClient);

      expect(router).toBeDefined();
      expect(typeof router).toBe('function'); // Express routers are functions
    });

    it('should have a POST route registered', () => {
      const router = createSetKeyRoute(mockPrisma as unknown as PrismaClient);

      // Check that the router has routes registered
      expect(router.stack).toBeDefined();
      expect(router.stack.length).toBeGreaterThan(0);

      // Find the POST route - use type assertion for Express internals
      const postRoute = (router.stack as unknown as Array<{ route?: { methods?: { post?: boolean } } }>).find(
        layer => layer.route?.methods?.post
      );
      expect(postRoute).toBeDefined();
    });
  });

  describe('provider validation', () => {
    it('should support OpenRouter provider', () => {
      // Verify the AIProvider enum includes OpenRouter
      expect(AIProvider.OpenRouter).toBe('openrouter');
    });

    it('should support OpenAI provider', () => {
      // Verify the AIProvider enum includes OpenAI
      expect(AIProvider.OpenAI).toBe('openai');
    });
  });
});
