/**
 * Tests for DELETE /wallet/:provider route
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
    delete: vi.fn(),
  },
};

import { createRemoveKeyRoute } from './removeKey.js';
import type { PrismaClient } from '@tzurot/common-types';

describe('DELETE /wallet/:provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('route factory', () => {
    it('should create an array of handlers', () => {
      const handlers = createRemoveKeyRoute(mockPrisma as unknown as PrismaClient);

      expect(handlers).toBeDefined();
      expect(Array.isArray(handlers)).toBe(true);
      expect(handlers.length).toBe(2); // [auth middleware, handler]
    });

    it('should have auth middleware as first handler', () => {
      const handlers = createRemoveKeyRoute(mockPrisma as unknown as PrismaClient);

      expect(typeof handlers[0]).toBe('function');
    });

    it('should have request handler as second handler', () => {
      const handlers = createRemoveKeyRoute(mockPrisma as unknown as PrismaClient);

      expect(typeof handlers[1]).toBe('function');
    });
  });
});
