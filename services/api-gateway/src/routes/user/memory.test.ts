/**
 * Tests for /user/memory routes
 *
 * Tests LTM (Long-Term Memory) management endpoints:
 * - GET /stats - Get memory statistics for a personality
 * - GET /focus - Get focus mode status
 * - POST /focus - Enable/disable focus mode
 * - POST /search - Semantic search of memories
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// Hoisted mocks must be declared with vi.hoisted
const { mockGenerateEmbedding, mockIsEmbeddingServiceAvailable } = vi.hoisted(() => ({
  mockGenerateEmbedding: vi.fn(),
  mockIsEmbeddingServiceAvailable: vi.fn(),
}));

// Mock EmbeddingService
vi.mock('../../services/EmbeddingService.js', () => ({
  generateEmbedding: mockGenerateEmbedding,
  formatAsVector: vi.fn((embedding: number[]) => `[${embedding.join(',')}]`),
  isEmbeddingServiceAvailable: mockIsEmbeddingServiceAvailable,
}));

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
    generateUserPersonalityConfigUuid: vi.fn(
      (userId: string, personalityId: string) => `config-${userId}-${personalityId}`
    ),
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
    findUnique: vi.fn(),
  },
  personality: {
    findUnique: vi.fn(),
  },
  userPersonalityConfig: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  memory: {
    count: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  $queryRaw: vi.fn(),
};

import { createMemoryRoutes } from './memory.js';
import type { PrismaClient } from '@tzurot/common-types';

// Test constants
const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_PERSONA_ID = '00000000-0000-0000-0000-000000000002';
const TEST_PERSONALITY_ID = '00000000-0000-0000-0000-000000000003';
const TEST_DISCORD_USER_ID = 'discord-user-123';

// Helper to create mock request/response
function createMockReqRes(body: Record<string, unknown> = {}, query: Record<string, unknown> = {}) {
  const req = {
    body,
    query,
    userId: TEST_DISCORD_USER_ID,
  } as unknown as Request & { userId: string };

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  return { req, res };
}

// Helper to get handler from router
function getHandler(
  router: ReturnType<typeof createMemoryRoutes>,
  method: 'get' | 'post' | 'delete',
  path: string
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Express router internals are untyped
  const layer = (router.stack as any[]).find(
    l => l.route?.path === path && l.route?.methods?.[method]
  );
  return (layer as { route: { stack: Array<{ handle: Function }> } }).route.stack[
    (layer as { route: { stack: Array<{ handle: Function }> } }).route.stack.length - 1
  ].handle;
}

describe('/user/memory routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mocks
    mockPrisma.user.findUnique.mockResolvedValue({
      id: TEST_USER_ID,
      discordId: TEST_DISCORD_USER_ID,
      defaultPersonaId: TEST_PERSONA_ID,
    });

    mockPrisma.personality.findUnique.mockResolvedValue({
      id: TEST_PERSONALITY_ID,
      name: 'Test Personality',
    });

    mockPrisma.userPersonalityConfig.findUnique.mockResolvedValue({
      personaId: TEST_PERSONA_ID,
      focusModeEnabled: false,
    });

    mockPrisma.userPersonalityConfig.upsert.mockResolvedValue({});

    mockPrisma.memory.count.mockResolvedValue(0);
    mockPrisma.memory.findFirst.mockResolvedValue(null);
    mockPrisma.memory.findMany.mockResolvedValue([]);
  });

  describe('route factory', () => {
    it('should create a router', () => {
      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);

      expect(router).toBeDefined();
      expect(typeof router).toBe('function');
    });

    it('should have GET /stats route registered', () => {
      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);

      const route = (
        router.stack as unknown as Array<{ route?: { path?: string; methods?: { get?: boolean } } }>
      ).find(layer => layer.route?.path === '/stats' && layer.route?.methods?.get);
      expect(route).toBeDefined();
    });

    it('should have GET /focus route registered', () => {
      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);

      const route = (
        router.stack as unknown as Array<{ route?: { path?: string; methods?: { get?: boolean } } }>
      ).find(layer => layer.route?.path === '/focus' && layer.route?.methods?.get);
      expect(route).toBeDefined();
    });

    it('should have POST /focus route registered', () => {
      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);

      const route = (
        router.stack as unknown as Array<{
          route?: { path?: string; methods?: { post?: boolean } };
        }>
      ).find(layer => layer.route?.path === '/focus' && layer.route?.methods?.post);
      expect(route).toBeDefined();
    });
  });

  describe('GET /user/memory/stats', () => {
    it('should reject missing personalityId', async () => {
      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/stats');
      const { req, res } = createMockReqRes({}, {});

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
          message: expect.stringContaining('personalityId'),
        })
      );
    });

    it('should return 404 when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/stats');
      const { req, res } = createMockReqRes({}, { personalityId: TEST_PERSONALITY_ID });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 404 when personality not found', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue(null);

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/stats');
      const { req, res } = createMockReqRes({}, { personalityId: TEST_PERSONALITY_ID });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return stats with zero counts when user has no persona', async () => {
      mockPrisma.userPersonalityConfig.findUnique.mockResolvedValue(null);
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: TEST_USER_ID }) // First call - check user
        .mockResolvedValueOnce({ defaultPersonaId: null }); // Second call - get default persona

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/stats');
      const { req, res } = createMockReqRes({}, { personalityId: TEST_PERSONALITY_ID });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          personalityId: TEST_PERSONALITY_ID,
          personaId: null,
          totalCount: 0,
          lockedCount: 0,
          oldestMemory: null,
          newestMemory: null,
          focusModeEnabled: false,
        })
      );
    });

    it('should return stats when user has memories', async () => {
      const oldestDate = new Date('2024-01-01');
      const newestDate = new Date('2024-06-01');

      mockPrisma.memory.count
        .mockResolvedValueOnce(42) // total count
        .mockResolvedValueOnce(5); // locked count
      mockPrisma.memory.findFirst
        .mockResolvedValueOnce({ createdAt: oldestDate }) // oldest
        .mockResolvedValueOnce({ createdAt: newestDate }); // newest

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/stats');
      const { req, res } = createMockReqRes({}, { personalityId: TEST_PERSONALITY_ID });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          personalityId: TEST_PERSONALITY_ID,
          personalityName: 'Test Personality',
          personaId: TEST_PERSONA_ID,
          totalCount: 42,
          lockedCount: 5,
          oldestMemory: oldestDate.toISOString(),
          newestMemory: newestDate.toISOString(),
          focusModeEnabled: false,
        })
      );
    });

    it('should return focusModeEnabled true when enabled', async () => {
      mockPrisma.userPersonalityConfig.findUnique.mockResolvedValue({
        personaId: TEST_PERSONA_ID,
        focusModeEnabled: true,
      });

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/stats');
      const { req, res } = createMockReqRes({}, { personalityId: TEST_PERSONALITY_ID });

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          focusModeEnabled: true,
        })
      );
    });
  });

  describe('GET /user/memory/focus', () => {
    it('should reject missing personalityId', async () => {
      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/focus');
      const { req, res } = createMockReqRes({}, {});

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('personalityId'),
        })
      );
    });

    it('should return 404 when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/focus');
      const { req, res } = createMockReqRes({}, { personalityId: TEST_PERSONALITY_ID });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return focusModeEnabled false when no config exists', async () => {
      mockPrisma.userPersonalityConfig.findUnique.mockResolvedValue(null);

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/focus');
      const { req, res } = createMockReqRes({}, { personalityId: TEST_PERSONALITY_ID });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          personalityId: TEST_PERSONALITY_ID,
          focusModeEnabled: false,
        })
      );
    });

    it('should return focusModeEnabled true when enabled', async () => {
      mockPrisma.userPersonalityConfig.findUnique.mockResolvedValue({
        focusModeEnabled: true,
      });

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/focus');
      const { req, res } = createMockReqRes({}, { personalityId: TEST_PERSONALITY_ID });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          personalityId: TEST_PERSONALITY_ID,
          focusModeEnabled: true,
        })
      );
    });
  });

  describe('POST /user/memory/focus', () => {
    it('should reject missing personalityId', async () => {
      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/focus');
      const { req, res } = createMockReqRes({ enabled: true });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('personalityId'),
        })
      );
    });

    it('should reject missing enabled field', async () => {
      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/focus');
      const { req, res } = createMockReqRes({ personalityId: TEST_PERSONALITY_ID });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('enabled'),
        })
      );
    });

    it('should reject non-boolean enabled', async () => {
      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/focus');
      const { req, res } = createMockReqRes({
        personalityId: TEST_PERSONALITY_ID,
        enabled: 'true', // string instead of boolean
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 404 when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/focus');
      const { req, res } = createMockReqRes({
        personalityId: TEST_PERSONALITY_ID,
        enabled: true,
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 404 when personality not found', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue(null);

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/focus');
      const { req, res } = createMockReqRes({
        personalityId: TEST_PERSONALITY_ID,
        enabled: true,
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should enable focus mode successfully', async () => {
      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/focus');
      const { req, res } = createMockReqRes({
        personalityId: TEST_PERSONALITY_ID,
        enabled: true,
      });

      await handler(req, res);

      expect(mockPrisma.userPersonalityConfig.upsert).toHaveBeenCalledWith({
        where: {
          userId_personalityId: {
            userId: TEST_USER_ID,
            personalityId: TEST_PERSONALITY_ID,
          },
        },
        update: {
          focusModeEnabled: true,
        },
        create: expect.objectContaining({
          userId: TEST_USER_ID,
          personalityId: TEST_PERSONALITY_ID,
          focusModeEnabled: true,
        }),
      });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          personalityId: TEST_PERSONALITY_ID,
          personalityName: 'Test Personality',
          focusModeEnabled: true,
          message: expect.stringContaining('enabled'),
        })
      );
    });

    it('should disable focus mode successfully', async () => {
      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/focus');
      const { req, res } = createMockReqRes({
        personalityId: TEST_PERSONALITY_ID,
        enabled: false,
      });

      await handler(req, res);

      expect(mockPrisma.userPersonalityConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: {
            focusModeEnabled: false,
          },
          create: expect.objectContaining({
            focusModeEnabled: false,
          }),
        })
      );

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          focusModeEnabled: false,
          message: expect.stringContaining('disabled'),
        })
      );
    });
  });

  describe('POST /user/memory/search', () => {
    const TEST_EMBEDDING = new Array(1536).fill(0.1);

    beforeEach(() => {
      // Setup default mocks for search
      mockIsEmbeddingServiceAvailable.mockReturnValue(true);
      mockGenerateEmbedding.mockResolvedValue(TEST_EMBEDDING);
      mockPrisma.$queryRaw.mockResolvedValue([]);
    });

    it('should have POST /search route registered', () => {
      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);

      const route = (
        router.stack as unknown as Array<{
          route?: { path?: string; methods?: { post?: boolean } };
        }>
      ).find(layer => layer.route?.path === '/search' && layer.route?.methods?.post);
      expect(route).toBeDefined();
    });

    it('should return 503 when embedding service is not available', async () => {
      mockIsEmbeddingServiceAvailable.mockReturnValue(false);

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/search');
      const { req, res } = createMockReqRes({ query: 'test search' }, {});

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'SERVICE_UNAVAILABLE',
        })
      );
    });

    it('should reject missing query', async () => {
      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/search');
      const { req, res } = createMockReqRes({}, {});

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
          message: expect.stringContaining('query'),
        })
      );
    });

    it('should reject empty query', async () => {
      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/search');
      const { req, res } = createMockReqRes({ query: '   ' }, {});

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
        })
      );
    });

    it('should return 400 for query exceeding max length', async () => {
      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/search');
      const longQuery = 'a'.repeat(501); // Exceeds 500 char limit
      const { req, res } = createMockReqRes({ query: longQuery }, {});

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
          message: expect.stringContaining('exceeds maximum length'),
        })
      );
    });

    it('should return 404 when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/search');
      const { req, res } = createMockReqRes({ query: 'test search' }, {});

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return empty results when user has no persona', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: TEST_USER_ID,
        discordId: TEST_DISCORD_USER_ID,
        defaultPersonaId: null,
      });

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/search');
      const { req, res } = createMockReqRes({ query: 'test search' }, {});

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          results: [],
          count: 0,
          hasMore: false,
        })
      );
    });

    it('should return semantic search results with searchType', async () => {
      const mockResults = [
        {
          id: 'memory-1',
          content: 'Test memory content',
          distance: 0.1,
          created_at: new Date('2025-01-01'),
          updated_at: new Date('2025-01-01'),
          personality_id: TEST_PERSONALITY_ID,
          personality_name: 'Test Personality',
          is_locked: false,
        },
      ];
      mockPrisma.$queryRaw.mockResolvedValue(mockResults);

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/search');
      const { req, res } = createMockReqRes({ query: 'test search' }, {});

      await handler(req, res);

      expect(mockGenerateEmbedding).toHaveBeenCalledWith('test search');
      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          results: expect.arrayContaining([
            expect.objectContaining({
              id: 'memory-1',
              content: 'Test memory content',
              similarity: 0.9, // 1 - 0.1 = 0.9
              personalityName: 'Test Personality',
              isLocked: false,
            }),
          ]),
          hasMore: false,
          searchType: 'semantic',
        })
      );
    });

    it('should fallback to text search when semantic returns no results', async () => {
      const textResults = [
        {
          id: 'memory-text-1',
          content: 'Memory containing Draco the dragon',
          created_at: new Date('2025-01-01'),
          updated_at: new Date('2025-01-01'),
          personality_id: TEST_PERSONALITY_ID,
          personality_name: 'Test Personality',
          is_locked: false,
        },
      ];
      // First call (semantic) returns empty, second call (text) returns results
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([]) // semantic search - no results
        .mockResolvedValueOnce(textResults); // text search - has results

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/search');
      const { req, res } = createMockReqRes({ query: 'Draco' }, {});

      await handler(req, res);

      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          results: expect.arrayContaining([
            expect.objectContaining({
              id: 'memory-text-1',
              content: 'Memory containing Draco the dragon',
              similarity: null, // Text search has no similarity
              personalityName: 'Test Personality',
            }),
          ]),
          searchType: 'text',
        })
      );
    });

    it('should return empty when both semantic and text search find nothing', async () => {
      // Both searches return empty
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([]) // semantic search
        .mockResolvedValueOnce([]); // text search

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/search');
      const { req, res } = createMockReqRes({ query: 'nonexistent' }, {});

      await handler(req, res);

      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          results: [],
          count: 0,
          searchType: 'text', // Falls through to text, which also returns empty
        })
      );
    });

    it('should clamp limit to max 50', async () => {
      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/search');
      const { req, res } = createMockReqRes({ query: 'test search', limit: 100 }, {});

      await handler(req, res);

      // Should still succeed (limit is clamped internally)
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should handle embedding generation error', async () => {
      mockGenerateEmbedding.mockRejectedValue(new Error('OpenAI API error'));

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/search');
      const { req, res } = createMockReqRes({ query: 'test search' }, {});

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'INTERNAL_ERROR',
        })
      );
    });

    it('should detect hasMore when results exceed limit', async () => {
      // Return 6 results when limit is 5 (default)
      const mockResults = Array.from({ length: 6 }, (_, i) => ({
        id: `memory-${i}`,
        content: `Content ${i}`,
        distance: 0.1,
        created_at: new Date('2025-01-01'),
        updated_at: new Date('2025-01-01'),
        personality_id: TEST_PERSONALITY_ID,
        personality_name: 'Test Personality',
        is_locked: false,
      }));
      mockPrisma.$queryRaw.mockResolvedValue(mockResults);

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/search');
      // Request with limit=5, but API returns 6 to check for hasMore
      const { req, res } = createMockReqRes({ query: 'test search', limit: 5 }, {});

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      // The response should only include 5 results (not 6)
      const responseCall = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(responseCall.results.length).toBeLessThanOrEqual(5);
      expect(responseCall.hasMore).toBe(true);
    });

    it('should skip semantic search when preferTextSearch is true', async () => {
      const textResults = [
        {
          id: 'memory-text-1',
          content: 'Memory from text search',
          created_at: new Date('2025-01-01'),
          updated_at: new Date('2025-01-01'),
          personality_id: TEST_PERSONALITY_ID,
          personality_name: 'Test Personality',
          is_locked: false,
        },
      ];
      mockPrisma.$queryRaw.mockResolvedValue(textResults);

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/search');
      const { req, res } = createMockReqRes({ query: 'test search', preferTextSearch: true }, {});

      await handler(req, res);

      // Should NOT call generateEmbedding when preferTextSearch is true
      expect(mockGenerateEmbedding).not.toHaveBeenCalled();
      // Should only make one query (text search), not two (semantic + fallback)
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          searchType: 'text',
        })
      );
    });

    it('should return 503 when embedding service returns null', async () => {
      mockGenerateEmbedding.mockResolvedValue(null);

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/search');
      const { req, res } = createMockReqRes({ query: 'test search' }, {});

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'SERVICE_UNAVAILABLE',
        })
      );
    });
  });

  describe('GET /user/memory/list', () => {
    it('should have GET /list route registered', () => {
      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);

      const route = (
        router.stack as unknown as Array<{ route?: { path?: string; methods?: { get?: boolean } } }>
      ).find(layer => layer.route?.path === '/list' && layer.route?.methods?.get);
      expect(route).toBeDefined();
    });

    it('should return 404 when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/list');
      const { req, res } = createMockReqRes({}, {});

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return empty list when user has no persona', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: TEST_USER_ID }) // First call - check user
        .mockResolvedValueOnce({ defaultPersonaId: null }); // Second call - get default persona

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/list');
      const { req, res } = createMockReqRes({}, {});

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          memories: [],
          total: 0,
          hasMore: false,
        })
      );
    });

    it('should return paginated memories', async () => {
      const mockMemories = [
        {
          id: 'memory-1',
          content: 'Test memory 1',
          createdAt: new Date('2025-06-15'),
          updatedAt: new Date('2025-06-15'),
          personalityId: TEST_PERSONALITY_ID,
          isLocked: false,
          personality: { name: 'test', displayName: 'Test Personality' },
        },
        {
          id: 'memory-2',
          content: 'Test memory 2',
          createdAt: new Date('2025-06-14'),
          updatedAt: new Date('2025-06-14'),
          personalityId: TEST_PERSONALITY_ID,
          isLocked: true,
          personality: { name: 'test', displayName: 'Test Personality' },
        },
      ];

      mockPrisma.memory.count.mockResolvedValue(2);
      mockPrisma.memory.findMany.mockResolvedValue(mockMemories);

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/list');
      const { req, res } = createMockReqRes({}, { limit: '10', offset: '0' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          memories: expect.arrayContaining([
            expect.objectContaining({
              id: 'memory-1',
              content: 'Test memory 1',
              personalityName: 'Test Personality',
              isLocked: false,
            }),
            expect.objectContaining({
              id: 'memory-2',
              isLocked: true,
            }),
          ]),
          total: 2,
          limit: 10,
          offset: 0,
          hasMore: false,
        })
      );
    });

    it('should filter by personalityId when provided', async () => {
      mockPrisma.memory.count.mockResolvedValue(0);
      mockPrisma.memory.findMany.mockResolvedValue([]);

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/list');
      const { req, res } = createMockReqRes({}, { personalityId: TEST_PERSONALITY_ID });

      await handler(req, res);

      expect(mockPrisma.memory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            personalityId: TEST_PERSONALITY_ID,
          }),
        })
      );
    });

    it('should clamp limit to max 50', async () => {
      mockPrisma.memory.count.mockResolvedValue(0);
      mockPrisma.memory.findMany.mockResolvedValue([]);

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/list');
      const { req, res } = createMockReqRes({}, { limit: '100' });

      await handler(req, res);

      expect(mockPrisma.memory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 50,
        })
      );
    });

    it('should use default limit when not specified', async () => {
      mockPrisma.memory.count.mockResolvedValue(0);
      mockPrisma.memory.findMany.mockResolvedValue([]);

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/list');
      const { req, res } = createMockReqRes({}, {});

      await handler(req, res);

      expect(mockPrisma.memory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 15, // Default limit
        })
      );
    });

    it('should handle pagination offset', async () => {
      mockPrisma.memory.count.mockResolvedValue(25);
      mockPrisma.memory.findMany.mockResolvedValue([]);

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/list');
      const { req, res } = createMockReqRes({}, { limit: '10', offset: '10' });

      await handler(req, res);

      expect(mockPrisma.memory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
        })
      );
    });

    it('should detect hasMore correctly', async () => {
      const mockMemories = [
        {
          id: 'memory-1',
          content: 'Test memory',
          createdAt: new Date(),
          updatedAt: new Date(),
          personalityId: TEST_PERSONALITY_ID,
          isLocked: false,
          personality: { name: 'test', displayName: 'Test' },
        },
      ];

      mockPrisma.memory.count.mockResolvedValue(25);
      mockPrisma.memory.findMany.mockResolvedValue(mockMemories);

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/list');
      const { req, res } = createMockReqRes({}, { limit: '10', offset: '0' });

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          hasMore: true, // 0 + 1 < 25
        })
      );
    });

    it('should support sort order parameters', async () => {
      mockPrisma.memory.count.mockResolvedValue(0);
      mockPrisma.memory.findMany.mockResolvedValue([]);

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/list');
      const { req, res } = createMockReqRes({}, { sort: 'updatedAt', order: 'asc' });

      await handler(req, res);

      expect(mockPrisma.memory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { updatedAt: 'asc' },
        })
      );
    });

    it('should default to createdAt desc when sort not specified', async () => {
      mockPrisma.memory.count.mockResolvedValue(0);
      mockPrisma.memory.findMany.mockResolvedValue([]);

      const router = createMemoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/list');
      const { req, res } = createMockReqRes({}, {});

      await handler(req, res);

      expect(mockPrisma.memory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
        })
      );
    });
  });
});
