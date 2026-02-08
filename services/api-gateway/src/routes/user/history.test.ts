/**
 * Tests for /user/history routes
 *
 * Tests STM (Short-Term Memory) management via context epochs.
 * Updated for per-persona epoch tracking via UserPersonaHistoryConfig.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// Mock ConversationHistoryService instance methods
const mockGetHistoryStats = vi.fn();

// Mock ConversationRetentionService instance methods
const mockClearHistory = vi.fn();

// Mock PersonaResolver instance methods
const mockResolve = vi.fn();

// Mock dependencies before imports
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');

  // Create a mock class that returns our mock methods
  class MockConversationHistoryService {
    getHistoryStats = mockGetHistoryStats;
  }

  // Mock ConversationRetentionService class
  class MockConversationRetentionService {
    clearHistory = mockClearHistory;
  }

  // Mock PersonaResolver class
  class MockPersonaResolver {
    resolve = mockResolve;
  }

  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    ConversationHistoryService: MockConversationHistoryService,
    ConversationRetentionService: MockConversationRetentionService,
    PersonaResolver: MockPersonaResolver,
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
  personality: {
    findUnique: vi.fn(),
  },
  persona: {
    findFirst: vi.fn(),
  },
  userPersonaHistoryConfig: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
  // Transaction mock - executes callback with mockPrisma as transaction client
  $transaction: vi.fn(async (callback: (tx: typeof mockPrisma) => Promise<unknown>) => {
    return callback(mockPrisma);
  }),
};

import { createHistoryRoutes } from './history.js';
import { getRouteHandler, findRoute } from '../../test/expressRouterUtils.js';
import type { PrismaClient } from '@tzurot/common-types';

// Test constants
const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_PERSONALITY_ID = '00000000-0000-0000-0000-000000000002';
const TEST_PERSONA_ID = '00000000-0000-0000-0000-000000000003';
const TEST_DISCORD_USER_ID = 'discord-user-123';
const TEST_PERSONALITY_SLUG = 'test-personality';
const TEST_CHANNEL_ID = '123456789012345678';

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
  router: ReturnType<typeof createHistoryRoutes>,
  method: 'get' | 'post' | 'delete',
  path: string
) {
  return getRouteHandler(router, method, path);
}

describe('/user/history routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mocks
    mockPrisma.user.findFirst.mockResolvedValue({
      id: TEST_USER_ID,
      discordId: TEST_DISCORD_USER_ID,
    });

    mockPrisma.personality.findUnique.mockResolvedValue({
      id: TEST_PERSONALITY_ID,
      slug: TEST_PERSONALITY_SLUG,
    });

    // Default PersonaResolver mock - returns a user-default persona
    mockResolve.mockResolvedValue({
      source: 'user-default',
      config: {
        personaId: TEST_PERSONA_ID,
        personaName: 'Test Persona',
      },
    });

    // Persona mock for explicit personaId validation
    mockPrisma.persona.findFirst.mockResolvedValue({
      id: TEST_PERSONA_ID,
      ownerId: TEST_USER_ID,
      name: 'Test Persona',
    });

    // Per-persona history config mocks
    mockPrisma.userPersonaHistoryConfig.findUnique.mockResolvedValue(null);
    mockPrisma.userPersonaHistoryConfig.upsert.mockResolvedValue({});
    mockPrisma.userPersonaHistoryConfig.update.mockResolvedValue({});
    mockPrisma.userPersonaHistoryConfig.deleteMany.mockResolvedValue({ count: 0 });

    mockGetHistoryStats.mockResolvedValue({
      totalMessages: 10,
      userMessages: 5,
      assistantMessages: 5,
      oldestMessage: new Date('2024-01-01'),
      newestMessage: new Date('2024-01-02'),
    });

    mockClearHistory.mockResolvedValue(5);
  });

  describe('route factory', () => {
    it('should create a router', () => {
      const router = createHistoryRoutes(mockPrisma as unknown as PrismaClient);

      expect(router).toBeDefined();
      expect(typeof router).toBe('function');
    });

    it('should have POST /clear route registered', () => {
      const router = createHistoryRoutes(mockPrisma as unknown as PrismaClient);

      expect(findRoute(router, 'post', '/clear')).toBeDefined();
    });

    it('should have POST /undo route registered', () => {
      const router = createHistoryRoutes(mockPrisma as unknown as PrismaClient);

      expect(findRoute(router, 'post', '/undo')).toBeDefined();
    });

    it('should have GET /stats route registered', () => {
      const router = createHistoryRoutes(mockPrisma as unknown as PrismaClient);

      expect(findRoute(router, 'get', '/stats')).toBeDefined();
    });
  });

  describe('POST /user/history/clear', () => {
    it('should reject missing personalitySlug', async () => {
      const router = createHistoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/clear');
      const { req, res } = createMockReqRes({});

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
          message: expect.stringContaining('personalitySlug is required'),
        })
      );
    });

    it('should reject empty personalitySlug', async () => {
      const router = createHistoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/clear');
      const { req, res } = createMockReqRes({ personalitySlug: '' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 404 when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const router = createHistoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/clear');
      const { req, res } = createMockReqRes({ personalitySlug: TEST_PERSONALITY_SLUG });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 404 when personality not found', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue(null);

      const router = createHistoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/clear');
      const { req, res } = createMockReqRes({ personalitySlug: TEST_PERSONALITY_SLUG });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 404 when no persona found (system-default)', async () => {
      // PersonaResolver returns system-default (no persona for user)
      mockResolve.mockResolvedValue({
        source: 'system-default',
        config: {},
      });

      const router = createHistoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/clear');
      const { req, res } = createMockReqRes({ personalitySlug: TEST_PERSONALITY_SLUG });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should set epoch on new config', async () => {
      const router = createHistoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/clear');
      const { req, res } = createMockReqRes({ personalitySlug: TEST_PERSONALITY_SLUG });

      await handler(req, res);

      expect(mockPrisma.userPersonaHistoryConfig.upsert).toHaveBeenCalledWith({
        where: {
          userId_personalityId_personaId: {
            userId: TEST_USER_ID,
            personalityId: TEST_PERSONALITY_ID,
            personaId: TEST_PERSONA_ID,
          },
        },
        update: expect.objectContaining({
          lastContextReset: expect.any(Date),
          previousContextReset: null,
        }),
        create: expect.objectContaining({
          userId: TEST_USER_ID,
          personalityId: TEST_PERSONALITY_ID,
          personaId: TEST_PERSONA_ID,
          lastContextReset: expect.any(Date),
          previousContextReset: null,
        }),
      });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          epoch: expect.any(String),
          personaId: TEST_PERSONA_ID,
          canUndo: false,
        })
      );
    });

    it('should preserve previous epoch for undo', async () => {
      const previousEpoch = new Date('2024-01-01');
      mockPrisma.userPersonaHistoryConfig.findUnique.mockResolvedValue({
        id: 'config-id',
        lastContextReset: previousEpoch,
        previousContextReset: null,
      });

      const router = createHistoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/clear');
      const { req, res } = createMockReqRes({ personalitySlug: TEST_PERSONALITY_SLUG });

      await handler(req, res);

      expect(mockPrisma.userPersonaHistoryConfig.upsert).toHaveBeenCalledWith({
        where: expect.anything(),
        update: expect.objectContaining({
          lastContextReset: expect.any(Date),
          previousContextReset: previousEpoch,
        }),
        create: expect.anything(),
      });

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          canUndo: true,
        })
      );
    });

    it('should use explicit personaId when provided', async () => {
      const router = createHistoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/clear');
      const { req, res } = createMockReqRes({
        personalitySlug: TEST_PERSONALITY_SLUG,
        personaId: TEST_PERSONA_ID,
      });

      await handler(req, res);

      // Should verify persona ownership via prisma.persona.findFirst
      expect(mockPrisma.persona.findFirst).toHaveBeenCalledWith({
        where: {
          id: TEST_PERSONA_ID,
          ownerId: TEST_USER_ID,
        },
      });

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should return 404 for explicit personaId not owned by user', async () => {
      mockPrisma.persona.findFirst.mockResolvedValue(null); // Persona not found or not owned

      const router = createHistoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/clear');
      const { req, res } = createMockReqRes({
        personalitySlug: TEST_PERSONALITY_SLUG,
        personaId: 'not-owned-persona-id',
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('POST /user/history/undo', () => {
    it('should reject missing personalitySlug', async () => {
      const router = createHistoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/undo');
      const { req, res } = createMockReqRes({});

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 404 when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const router = createHistoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/undo');
      const { req, res } = createMockReqRes({ personalitySlug: TEST_PERSONALITY_SLUG });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should restore full visibility when previousContextReset is null (first clear undo)', async () => {
      // After first clear: record exists with lastContextReset set, previousContextReset is null
      // Undo should restore to full visibility (set lastContextReset to null)
      mockPrisma.userPersonaHistoryConfig.findUnique.mockResolvedValue({
        id: 'config-id',
        lastContextReset: new Date('2024-01-02'),
        previousContextReset: null, // First clear - no previous epoch
      });

      const router = createHistoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/undo');
      const { req, res } = createMockReqRes({ personalitySlug: TEST_PERSONALITY_SLUG });

      await handler(req, res);

      // Should succeed and restore to full visibility (null epoch)
      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockPrisma.userPersonaHistoryConfig.update).toHaveBeenCalledWith({
        where: {
          userId_personalityId_personaId: {
            userId: TEST_USER_ID,
            personalityId: TEST_PERSONALITY_ID,
            personaId: TEST_PERSONA_ID,
          },
        },
        data: {
          lastContextReset: null, // Restored to full visibility
          previousContextReset: null,
        },
      });
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          restoredEpoch: null, // null means full visibility
        })
      );
    });

    it('should return error when config does not exist', async () => {
      mockPrisma.userPersonaHistoryConfig.findUnique.mockResolvedValue(null);

      const router = createHistoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/undo');
      const { req, res } = createMockReqRes({ personalitySlug: TEST_PERSONALITY_SLUG });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return error when already at full visibility (lastContextReset is null)', async () => {
      // After undo to full visibility, lastContextReset is null
      // Another undo should fail
      mockPrisma.userPersonaHistoryConfig.findUnique.mockResolvedValue({
        id: 'config-id',
        lastContextReset: null, // Already at full visibility
        previousContextReset: null,
      });

      const router = createHistoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/undo');
      const { req, res } = createMockReqRes({ personalitySlug: TEST_PERSONALITY_SLUG });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('No previous context'),
        })
      );
    });

    it('should restore previous epoch successfully', async () => {
      const previousEpoch = new Date('2024-01-01');
      mockPrisma.userPersonaHistoryConfig.findUnique.mockResolvedValue({
        id: 'config-id',
        lastContextReset: new Date('2024-01-02'),
        previousContextReset: previousEpoch,
      });

      const router = createHistoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/undo');
      const { req, res } = createMockReqRes({ personalitySlug: TEST_PERSONALITY_SLUG });

      await handler(req, res);

      expect(mockPrisma.userPersonaHistoryConfig.update).toHaveBeenCalledWith({
        where: {
          userId_personalityId_personaId: {
            userId: TEST_USER_ID,
            personalityId: TEST_PERSONALITY_ID,
            personaId: TEST_PERSONA_ID,
          },
        },
        data: {
          lastContextReset: previousEpoch,
          previousContextReset: null,
        },
      });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          personaId: TEST_PERSONA_ID,
          restoredEpoch: previousEpoch.toISOString(),
        })
      );
    });
  });

  describe('GET /user/history/stats', () => {
    it('should reject missing personalitySlug', async () => {
      const router = createHistoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/stats');
      const { req, res } = createMockReqRes({}, { channelId: TEST_CHANNEL_ID });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('personalitySlug'),
        })
      );
    });

    it('should reject missing channelId', async () => {
      const router = createHistoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/stats');
      const { req, res } = createMockReqRes({}, { personalitySlug: TEST_PERSONALITY_SLUG });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('channelId'),
        })
      );
    });

    it('should return 404 when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const router = createHistoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/stats');
      const { req, res } = createMockReqRes(
        {},
        { personalitySlug: TEST_PERSONALITY_SLUG, channelId: TEST_CHANNEL_ID }
      );

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return stats without epoch', async () => {
      mockGetHistoryStats.mockResolvedValue({
        totalMessages: 10,
        userMessages: 5,
        assistantMessages: 5,
        oldestMessage: new Date('2024-01-01'),
        newestMessage: new Date('2024-01-02'),
      });

      const router = createHistoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/stats');
      const { req, res } = createMockReqRes(
        {},
        { personalitySlug: TEST_PERSONALITY_SLUG, channelId: TEST_CHANNEL_ID }
      );

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: TEST_CHANNEL_ID,
          personalitySlug: TEST_PERSONALITY_SLUG,
          personaId: TEST_PERSONA_ID,
          visible: expect.objectContaining({
            totalMessages: 10,
            userMessages: 5,
            assistantMessages: 5,
          }),
          hidden: expect.objectContaining({
            count: 0, // No hidden messages when no epoch
          }),
          contextEpoch: null,
          canUndo: false,
        })
      );
    });

    it('should return stats with epoch filtering', async () => {
      const epoch = new Date('2024-01-01T12:00:00Z');
      mockPrisma.userPersonaHistoryConfig.findUnique.mockResolvedValue({
        id: 'config-id',
        lastContextReset: epoch,
        previousContextReset: null,
      });

      // First call (with epoch) - visible messages
      mockGetHistoryStats.mockResolvedValueOnce({
        totalMessages: 5,
        userMessages: 3,
        assistantMessages: 2,
        oldestMessage: new Date('2024-01-01T13:00:00Z'),
        newestMessage: new Date('2024-01-02'),
      });

      // Second call (no epoch) - total messages
      mockGetHistoryStats.mockResolvedValueOnce({
        totalMessages: 15,
        userMessages: 8,
        assistantMessages: 7,
        oldestMessage: new Date('2024-01-01'),
        newestMessage: new Date('2024-01-02'),
      });

      const router = createHistoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/stats');
      const { req, res } = createMockReqRes(
        {},
        { personalitySlug: TEST_PERSONALITY_SLUG, channelId: TEST_CHANNEL_ID }
      );

      await handler(req, res);

      expect(mockGetHistoryStats).toHaveBeenCalledTimes(2);

      // First call with epoch
      expect(mockGetHistoryStats).toHaveBeenNthCalledWith(
        1,
        TEST_CHANNEL_ID,
        TEST_PERSONALITY_ID,
        epoch
      );

      // Second call without epoch
      expect(mockGetHistoryStats).toHaveBeenNthCalledWith(
        2,
        TEST_CHANNEL_ID,
        TEST_PERSONALITY_ID,
        undefined
      );

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          personaId: TEST_PERSONA_ID,
          visible: expect.objectContaining({
            totalMessages: 5,
          }),
          hidden: expect.objectContaining({
            count: 10, // 15 total - 5 visible = 10 hidden
          }),
          contextEpoch: epoch.toISOString(),
        })
      );
    });

    it('should show canUndo when previousContextReset exists', async () => {
      mockPrisma.userPersonaHistoryConfig.findUnique.mockResolvedValue({
        id: 'config-id',
        lastContextReset: new Date('2024-01-02'),
        previousContextReset: new Date('2024-01-01'), // Has previous epoch
      });

      const router = createHistoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/stats');
      const { req, res } = createMockReqRes(
        {},
        { personalitySlug: TEST_PERSONALITY_SLUG, channelId: TEST_CHANNEL_ID }
      );

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          canUndo: true,
        })
      );
    });
  });

  describe('DELETE /user/history/hard-delete', () => {
    it('should have DELETE /hard-delete route registered', () => {
      const router = createHistoryRoutes(mockPrisma as unknown as PrismaClient);

      expect(findRoute(router, 'delete', '/hard-delete')).toBeDefined();
    });

    it('should reject missing personalitySlug', async () => {
      const router = createHistoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/hard-delete');
      const { req, res } = createMockReqRes({ channelId: TEST_CHANNEL_ID });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
          message: expect.stringContaining('personalitySlug is required'),
        })
      );
    });

    it('should reject missing channelId', async () => {
      const router = createHistoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/hard-delete');
      const { req, res } = createMockReqRes({ personalitySlug: TEST_PERSONALITY_SLUG });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
          message: expect.stringContaining('channelId is required'),
        })
      );
    });

    it('should return 404 when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const router = createHistoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/hard-delete');
      const { req, res } = createMockReqRes({
        personalitySlug: TEST_PERSONALITY_SLUG,
        channelId: TEST_CHANNEL_ID,
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 404 when personality not found', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue(null);

      const router = createHistoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/hard-delete');
      const { req, res } = createMockReqRes({
        personalitySlug: TEST_PERSONALITY_SLUG,
        channelId: TEST_CHANNEL_ID,
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should delete history for resolved persona by default', async () => {
      mockClearHistory.mockResolvedValue(15);

      const router = createHistoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/hard-delete');
      const { req, res } = createMockReqRes({
        personalitySlug: TEST_PERSONALITY_SLUG,
        channelId: TEST_CHANNEL_ID,
      });

      await handler(req, res);

      // Should include personaId for per-persona deletion
      expect(mockClearHistory).toHaveBeenCalledWith(
        TEST_CHANNEL_ID,
        TEST_PERSONALITY_ID,
        TEST_PERSONA_ID
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          deletedCount: 15,
          personaId: TEST_PERSONA_ID,
          message: 'Permanently deleted 15 messages from conversation history.',
        })
      );
    });

    it('should handle singular message count in response', async () => {
      mockClearHistory.mockResolvedValue(1);

      const router = createHistoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/hard-delete');
      const { req, res } = createMockReqRes({
        personalitySlug: TEST_PERSONALITY_SLUG,
        channelId: TEST_CHANNEL_ID,
      });

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Permanently deleted 1 message from conversation history.',
        })
      );
    });

    it('should set irreversible context epoch instead of deleting config', async () => {
      const router = createHistoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/hard-delete');
      const { req, res } = createMockReqRes({
        personalitySlug: TEST_PERSONALITY_SLUG,
        channelId: TEST_CHANNEL_ID,
      });

      await handler(req, res);

      // Should upsert with irreversible epoch (previousContextReset = null blocks undo)
      expect(mockPrisma.userPersonaHistoryConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId_personalityId_personaId: {
              userId: TEST_USER_ID,
              personalityId: TEST_PERSONALITY_ID,
              personaId: TEST_PERSONA_ID,
            },
          },
          update: expect.objectContaining({
            lastContextReset: expect.any(Date),
            previousContextReset: null, // Blocks undo - makes this irreversible
          }),
          create: expect.objectContaining({
            userId: TEST_USER_ID,
            personalityId: TEST_PERSONALITY_ID,
            personaId: TEST_PERSONA_ID,
            lastContextReset: expect.any(Date),
            previousContextReset: null,
          }),
        })
      );

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should succeed and set epoch even when no messages to delete', async () => {
      mockClearHistory.mockResolvedValue(0);

      const router = createHistoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/hard-delete');
      const { req, res } = createMockReqRes({
        personalitySlug: TEST_PERSONALITY_SLUG,
        channelId: TEST_CHANNEL_ID,
      });

      await handler(req, res);

      // clearHistory should still be called
      expect(mockClearHistory).toHaveBeenCalled();

      // upsert should be called to set irreversible epoch
      expect(mockPrisma.userPersonaHistoryConfig.upsert).toHaveBeenCalled();

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should handle zero messages deleted', async () => {
      mockClearHistory.mockResolvedValue(0);

      const router = createHistoryRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/hard-delete');
      const { req, res } = createMockReqRes({
        personalitySlug: TEST_PERSONALITY_SLUG,
        channelId: TEST_CHANNEL_ID,
      });

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          deletedCount: 0,
          message: 'Permanently deleted 0 messages from conversation history.',
        })
      );
    });
  });
});
