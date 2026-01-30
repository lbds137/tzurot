/**
 * Conversation Lookup Routes Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response } from 'express';

// Mock getMessageByDiscordId method
const mockGetMessageByDiscordId = vi.fn();

// Mock dependencies before imports
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');

  // Create a mock class that returns our mock methods
  class MockConversationHistoryService {
    getMessageByDiscordId = mockGetMessageByDiscordId;
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
  };
});

vi.mock('../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

// Mock Prisma (minimal - route doesn't use it directly)
const mockPrisma = {};

import { createConversationLookupRoutes } from './conversationLookup.js';
import type { PrismaClient } from '@tzurot/common-types';

// Helper to create mock request/response
function createMockReqRes(query: Record<string, unknown> = {}) {
  const req = {
    query,
  } as unknown as Request;

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  return { req, res };
}

describe('conversationLookup routes', () => {
  let router: ReturnType<typeof createConversationLookupRoutes>;

  beforeEach(() => {
    vi.clearAllMocks();
    router = createConversationLookupRoutes(mockPrisma as unknown as PrismaClient);
  });

  describe('GET /conversation/message-personality', () => {
    // Helper to get the route handler directly
    function getHandler() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test utility accessing router internals
      const layer = (router as any).stack.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test utility accessing router internals
        (l: any) => l.route?.path === '/message-personality'
      );
      return layer?.route?.stack[0]?.handle;
    }

    it('should return 400 when discordMessageId is missing', async () => {
      const { req, res } = createMockReqRes({});
      const handler = getHandler();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('discordMessageId'),
        })
      );
    });

    it('should return 404 when message is not found', async () => {
      mockGetMessageByDiscordId.mockResolvedValue(null);
      const { req, res } = createMockReqRes({ discordMessageId: '123456789' });
      const handler = getHandler();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(null);
      expect(mockGetMessageByDiscordId).toHaveBeenCalledWith('123456789');
    });

    it('should return 404 when message has no personalityId', async () => {
      mockGetMessageByDiscordId.mockResolvedValue({
        id: 'msg-uuid',
        content: 'Hello',
        // No personalityId
      });
      const { req, res } = createMockReqRes({ discordMessageId: '123456789' });
      const handler = getHandler();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(null);
    });

    it('should return personality info when message is found', async () => {
      mockGetMessageByDiscordId.mockResolvedValue({
        id: 'msg-uuid',
        content: 'Hello',
        personalityId: 'pers-uuid-123',
        personalityName: 'Lilith',
      });
      const { req, res } = createMockReqRes({ discordMessageId: '123456789' });
      const handler = getHandler();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        personalityId: 'pers-uuid-123',
        personalityName: 'Lilith',
      });
      expect(mockGetMessageByDiscordId).toHaveBeenCalledWith('123456789');
    });

    it('should return personality info without name when name is undefined', async () => {
      mockGetMessageByDiscordId.mockResolvedValue({
        id: 'msg-uuid',
        content: 'Hello',
        personalityId: 'pers-uuid-456',
        // No personalityName
      });
      const { req, res } = createMockReqRes({ discordMessageId: '987654321' });
      const handler = getHandler();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        personalityId: 'pers-uuid-456',
        personalityName: undefined,
      });
    });

    it('should handle long Discord snowflake IDs', async () => {
      mockGetMessageByDiscordId.mockResolvedValue({
        id: 'msg-uuid',
        content: 'Hello',
        personalityId: 'pers-uuid',
        personalityName: 'Test',
      });
      const { req, res } = createMockReqRes({ discordMessageId: '1234567890123456789' });
      const handler = getHandler();

      await handler(req, res);

      expect(mockGetMessageByDiscordId).toHaveBeenCalledWith('1234567890123456789');
    });
  });
});
