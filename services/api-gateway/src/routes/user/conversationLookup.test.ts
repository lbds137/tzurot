/**
 * Conversation Lookup Routes Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response } from 'express';

// Mock getMessageByDiscordId method and legacy trigger-memory check
const mockGetMessageByDiscordId = vi.fn();
const mockTriggerMemoryExists = vi.fn();

// Mock dependencies before imports
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
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

vi.mock('@tzurot/conversation-history', () => ({
  ConversationHistoryService: class {
    getMessageByDiscordId = mockGetMessageByDiscordId;
  },
  triggerMemoryExists: (...args: unknown[]) => mockTriggerMemoryExists(...args),
}));

vi.mock('../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

// Mock Prisma (includes the methods behind triggerMemoryExists so tests can assert they are not called)
const mockPrisma = {
  conversationHistory: { findFirst: vi.fn() },
  memory: { findFirst: vi.fn() },
};

import { handleLookupPersonalityFromMessage } from './conversationLookup.js';
import { MessageRole } from '@tzurot/common-types/constants/message';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { asRouteHandler, stubRouteResolvers } from '../../test/shared-route-test-utils.js';

// Helper to create mock request/response
function createMockReqRes(query: Record<string, unknown> = {}) {
  const req = {
    query,
    // Express always populates `req.params` (at least `{}`) even when the
    // route declares no `:param` segments — withManifestInput's params
    // schema parses it unconditionally, so an absent field here would 400
    // before the handler runs.
    params: {},
  } as unknown as Request;

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  return { req, res };
}

describe('conversationLookup routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/internal/conversation/message-personality', () => {
    // The bare handler export — the shape routes/_generated/mounts.ts mounts.
    function getHandler() {
      return asRouteHandler(
        handleLookupPersonalityFromMessage({
          ...stubRouteResolvers(),
          prisma: mockPrisma as unknown as PrismaClient,
        })
      );
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

    it('should return 400 when discordMessageId is a repeated query key (array value)', async () => {
      const { req, res } = createMockReqRes({ discordMessageId: ['a', 'b'] });
      const handler = getHandler();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockGetMessageByDiscordId).not.toHaveBeenCalled();
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
        role: MessageRole.User,
        content: 'Hello',
        personalitySlug: 'lilith',
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
        role: MessageRole.User,
        content: 'Hello',
        personalityId: 'pers-uuid-123',
        personalityName: 'Lilith',
        personalitySlug: 'lilith',
      });
      const { req, res } = createMockReqRes({ discordMessageId: '123456789' });
      const handler = getHandler();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        personalityId: 'pers-uuid-123',
        personalityName: 'Lilith',
        personalitySlug: 'lilith',
        role: MessageRole.User,
        incognito: null,
      });
      expect(mockGetMessageByDiscordId).toHaveBeenCalledWith('123456789');
    });

    it('should return personality info without name when name is undefined', async () => {
      mockGetMessageByDiscordId.mockResolvedValue({
        id: 'msg-uuid',
        role: MessageRole.User,
        content: 'Hello',
        personalityId: 'pers-uuid-456',
        personalitySlug: 'lilith',
        // No personalityName
      });
      const { req, res } = createMockReqRes({ discordMessageId: '987654321' });
      const handler = getHandler();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        personalityId: 'pers-uuid-456',
        personalityName: undefined,
        personalitySlug: 'lilith',
        role: MessageRole.User,
        incognito: null,
      });
    });

    it('returns personalitySlug and incognito from messageMetadata when present', async () => {
      mockGetMessageByDiscordId.mockResolvedValue({
        id: 'msg-uuid',
        role: MessageRole.Assistant,
        content: 'Hello',
        personalityId: 'pers-uuid-789',
        personalityName: 'Lilith',
        personalitySlug: 'lilith',
        messageMetadata: { incognito: true },
      });
      const { req, res } = createMockReqRes({ discordMessageId: '555555555' });
      const handler = getHandler();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        personalityId: 'pers-uuid-789',
        personalityName: 'Lilith',
        personalitySlug: 'lilith',
        role: MessageRole.Assistant,
        incognito: true,
      });
    });

    it('returns incognito=false when messageMetadata.incognito is false, and null when absent', async () => {
      mockGetMessageByDiscordId.mockResolvedValueOnce({
        id: 'msg-uuid-false',
        role: MessageRole.User,
        content: 'Hello',
        personalityId: 'pers-uuid-789',
        personalityName: 'Lilith',
        personalitySlug: 'lilith',
        messageMetadata: { incognito: false },
      });
      const { req: reqFalse, res: resFalse } = createMockReqRes({ discordMessageId: '555555556' });
      const handler = getHandler();

      await handler(reqFalse, resFalse);

      expect(resFalse.json).toHaveBeenCalledWith({
        personalityId: 'pers-uuid-789',
        personalityName: 'Lilith',
        personalitySlug: 'lilith',
        role: MessageRole.User,
        incognito: false,
      });

      mockGetMessageByDiscordId.mockResolvedValueOnce({
        id: 'msg-uuid-absent',
        role: MessageRole.User,
        content: 'Hello',
        personalityId: 'pers-uuid-789',
        personalityName: 'Lilith',
        personalitySlug: 'lilith',
        messageMetadata: {},
      });
      const { req: reqAbsent, res: resAbsent } = createMockReqRes({
        discordMessageId: '555555557',
      });

      await handler(reqAbsent, resAbsent);

      expect(resAbsent.json).toHaveBeenCalledWith({
        personalityId: 'pers-uuid-789',
        personalityName: 'Lilith',
        personalitySlug: 'lilith',
        role: MessageRole.User,
        incognito: null,
      });
    });

    it('should handle long Discord snowflake IDs', async () => {
      mockGetMessageByDiscordId.mockResolvedValue({
        id: 'msg-uuid',
        role: MessageRole.User,
        content: 'Hello',
        personalityId: 'pers-uuid',
        personalityName: 'Test',
        personalitySlug: 'test',
      });
      const { req, res } = createMockReqRes({ discordMessageId: '1234567890123456789' });
      const handler = getHandler();

      await handler(req, res);

      expect(mockGetMessageByDiscordId).toHaveBeenCalledWith('1234567890123456789');
    });

    it('does not query triggerMemoryExists when messageMetadata.incognito is present on an assistant row', async () => {
      mockGetMessageByDiscordId.mockResolvedValue({
        id: 'msg-uuid-meta',
        role: 'assistant',
        content: 'Hello',
        channelId: 'chan-1',
        createdAt: new Date('2026-06-01T12:00:00.000Z'),
        personalityId: 'pers-uuid-789',
        personalityName: 'Lilith',
        personalitySlug: 'lilith',
        messageMetadata: { incognito: false },
      });
      const { req, res } = createMockReqRes({
        discordMessageId: '555555558',
        includeIncognitoEvidence: true,
      });
      const handler = getHandler();

      await handler(req, res);

      expect(mockTriggerMemoryExists).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        personalityId: 'pers-uuid-789',
        personalityName: 'Lilith',
        personalitySlug: 'lilith',
        role: 'assistant',
        incognito: false,
      });
      expect(vi.mocked(res.json).mock.calls[0][0]).not.toHaveProperty('triggerMemoryExists');
    });

    it('does not query triggerMemoryExists for a legacy assistant row when includeIncognitoEvidence is omitted', async () => {
      const createdAt = new Date('2026-05-01T12:00:00.000Z');
      mockGetMessageByDiscordId.mockResolvedValue({
        id: 'msg-uuid-legacy-no-flag',
        role: 'assistant',
        content: 'Legacy reply',
        channelId: 'chan-legacy',
        createdAt,
        personalityId: 'pers-uuid-789',
        personalityName: 'Lilith',
        personalitySlug: 'lilith',
        messageMetadata: {},
      });
      mockTriggerMemoryExists.mockResolvedValue(true);
      const { req, res } = createMockReqRes({ discordMessageId: '555555559' });
      const handler = getHandler();

      await handler(req, res);

      expect(mockTriggerMemoryExists).not.toHaveBeenCalled();
      expect(mockPrisma.conversationHistory.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.memory.findFirst).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        personalityId: 'pers-uuid-789',
        personalityName: 'Lilith',
        personalitySlug: 'lilith',
        role: 'assistant',
        incognito: null,
      });
      expect(vi.mocked(res.json).mock.calls[0][0]).not.toHaveProperty('triggerMemoryExists');
    });

    it('computes triggerMemoryExists for a legacy assistant row when includeIncognitoEvidence is true', async () => {
      const createdAt = new Date('2026-05-01T12:00:00.000Z');
      mockGetMessageByDiscordId.mockResolvedValue({
        id: 'msg-uuid-legacy',
        role: 'assistant',
        content: 'Legacy reply',
        channelId: 'chan-legacy',
        createdAt,
        personalityId: 'pers-uuid-789',
        personalityName: 'Lilith',
        personalitySlug: 'lilith',
        messageMetadata: {},
      });
      mockTriggerMemoryExists.mockResolvedValue(true);
      const { req, res } = createMockReqRes({
        discordMessageId: '555555559',
        includeIncognitoEvidence: true,
      });
      const handler = getHandler();

      await handler(req, res);

      expect(mockTriggerMemoryExists).toHaveBeenCalledWith(mockPrisma, {
        channelId: 'chan-legacy',
        personalityId: 'pers-uuid-789',
        createdAt,
      });
      expect(res.json).toHaveBeenCalledWith({
        personalityId: 'pers-uuid-789',
        personalityName: 'Lilith',
        personalitySlug: 'lilith',
        role: 'assistant',
        incognito: null,
        triggerMemoryExists: true,
      });
    });

    it("computes triggerMemoryExists for a legacy assistant row when req.query carries includeIncognitoEvidence as wire string 'true'", async () => {
      const createdAt = new Date('2026-05-01T12:00:00.000Z');
      mockGetMessageByDiscordId.mockResolvedValue({
        id: 'msg-uuid-legacy-wire-true',
        role: 'assistant',
        content: 'Legacy reply',
        channelId: 'chan-legacy',
        createdAt,
        personalityId: 'pers-uuid-789',
        personalityName: 'Lilith',
        personalitySlug: 'lilith',
        messageMetadata: {},
      });
      mockTriggerMemoryExists.mockResolvedValue(true);
      const { req, res } = createMockReqRes({
        discordMessageId: '555555559',
        includeIncognitoEvidence: 'true',
      });
      const handler = getHandler();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockTriggerMemoryExists).toHaveBeenCalledWith(mockPrisma, {
        channelId: 'chan-legacy',
        personalityId: 'pers-uuid-789',
        createdAt,
      });
      expect(res.json).toHaveBeenCalledWith({
        personalityId: 'pers-uuid-789',
        personalityName: 'Lilith',
        personalitySlug: 'lilith',
        role: 'assistant',
        incognito: null,
        triggerMemoryExists: true,
      });
    });

    it("keeps the legacy evidence gate closed when req.query carries includeIncognitoEvidence as wire string 'false'", async () => {
      const createdAt = new Date('2026-05-01T12:00:00.000Z');
      mockGetMessageByDiscordId.mockResolvedValue({
        id: 'msg-uuid-legacy-wire-false',
        role: 'assistant',
        content: 'Legacy reply',
        channelId: 'chan-legacy',
        createdAt,
        personalityId: 'pers-uuid-789',
        personalityName: 'Lilith',
        personalitySlug: 'lilith',
        messageMetadata: {},
      });
      mockTriggerMemoryExists.mockResolvedValue(true);
      const { req, res } = createMockReqRes({
        discordMessageId: '555555559',
        includeIncognitoEvidence: 'false',
      });
      const handler = getHandler();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockTriggerMemoryExists).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        personalityId: 'pers-uuid-789',
        personalityName: 'Lilith',
        personalitySlug: 'lilith',
        role: 'assistant',
        incognito: null,
      });
      expect(vi.mocked(res.json).mock.calls[0][0]).not.toHaveProperty('triggerMemoryExists');
    });

    it('returns role=user and does not compute triggerMemoryExists for a user row', async () => {
      mockGetMessageByDiscordId.mockResolvedValue({
        id: 'msg-uuid-user',
        role: 'user',
        content: 'User question',
        channelId: 'chan-user',
        createdAt: new Date('2026-05-01T12:00:00.000Z'),
        personalityId: 'pers-uuid-789',
        personalityName: 'Lilith',
        personalitySlug: 'lilith',
      });
      const { req, res } = createMockReqRes({
        discordMessageId: '555555560',
        includeIncognitoEvidence: true,
      });
      const handler = getHandler();

      await handler(req, res);

      expect(mockTriggerMemoryExists).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        personalityId: 'pers-uuid-789',
        personalityName: 'Lilith',
        personalitySlug: 'lilith',
        role: 'user',
        incognito: null,
      });
      expect(vi.mocked(res.json).mock.calls[0][0]).not.toHaveProperty('triggerMemoryExists');
    });

    it('returns 200 with personalityId and omits triggerMemoryExists when triggerMemoryExists throws', async () => {
      const createdAt = new Date('2026-05-01T12:00:00.000Z');
      mockGetMessageByDiscordId.mockResolvedValue({
        id: 'msg-uuid-legacy-err',
        role: 'assistant',
        content: 'Legacy reply',
        channelId: 'chan-legacy',
        createdAt,
        personalityId: 'pers-uuid-789',
        personalityName: 'Lilith',
        personalitySlug: 'lilith',
        messageMetadata: {},
      });
      mockTriggerMemoryExists.mockRejectedValueOnce(new Error('db timeout'));
      const { req, res } = createMockReqRes({
        discordMessageId: '555555561',
        includeIncognitoEvidence: true,
      });
      const handler = getHandler();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        personalityId: 'pers-uuid-789',
        personalityName: 'Lilith',
        personalitySlug: 'lilith',
        role: 'assistant',
        incognito: null,
      });
      expect(vi.mocked(res.json).mock.calls[0][0]).not.toHaveProperty('triggerMemoryExists');
    });
  });
});
