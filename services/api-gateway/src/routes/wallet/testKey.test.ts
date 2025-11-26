/**
 * Tests for POST /wallet/test route
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
    decryptApiKey: vi.fn().mockReturnValue('decrypted-api-key'),
    AIProvider: {
      OpenRouter: 'openrouter',
      OpenAI: 'openai',
      Gemini: 'gemini',
    },
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
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
};

import { createTestKeyRoute } from './testKey.js';
import type { PrismaClient } from '@tzurot/common-types';

describe('POST /wallet/test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('route factory', () => {
    it('should create a router', () => {
      const router = createTestKeyRoute(mockPrisma as unknown as PrismaClient);

      expect(router).toBeDefined();
      expect(typeof router).toBe('function');
    });

    it('should have POST route registered', () => {
      const router = createTestKeyRoute(mockPrisma as unknown as PrismaClient);

      expect(router.stack).toBeDefined();
      expect(router.stack.length).toBeGreaterThan(0);

      const postRoute = (
        router.stack as unknown as Array<{ route?: { path?: string; methods?: { post?: boolean } } }>
      ).find(layer => layer.route?.path === '/' && layer.route?.methods?.post);
      expect(postRoute).toBeDefined();
    });
  });
});
