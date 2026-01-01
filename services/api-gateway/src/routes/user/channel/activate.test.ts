/**
 * Tests for POST /user/channel/activate
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types';
import {
  createMockPrisma,
  createMockReqRes,
  createMockPersonality,
  createMockActivation,
  getHandler,
  mockIsBotOwner,
  setupStandardMocks,
  MOCK_USER_UUID,
  MOCK_DISCORD_USER_ID,
} from './test-utils.js';

// Mock dependencies before imports
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  const { mockIsBotOwner: mockFn } = await import('./test-utils.js');
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    isBotOwner: (...args: unknown[]) => (mockFn as (...args: unknown[]) => boolean)(...args),
    generateChannelSettingsUuid: vi.fn(() => 'deterministic-activation-uuid'),
  };
});

vi.mock('../../../services/AuthMiddleware.js', () => ({
  requireUserAuth: vi.fn(() => vi.fn((_req: unknown, _res: unknown, next: () => void) => next())),
  requireServiceAuth: vi.fn(() =>
    vi.fn((_req: unknown, _res: unknown, next: () => void) => next())
  ),
}));

vi.mock('../../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

import { createChannelRoutes } from './index.js';

describe('POST /user/channel/activate', () => {
  const mockPrisma = createMockPrisma();

  beforeEach(() => {
    vi.clearAllMocks();
    setupStandardMocks(mockPrisma);
  });

  it('should activate a public personality in a channel', async () => {
    const personality = createMockPersonality({ isPublic: true });
    const createdSettings = createMockActivation();

    mockPrisma.personality.findUnique.mockResolvedValue(personality);
    mockPrisma.channelSettings.upsert.mockResolvedValue(createdSettings);

    const router = createChannelRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'post', '/activate');
    const { req, res } = createMockReqRes({
      channelId: MOCK_DISCORD_USER_ID,
      personalitySlug: 'test-character',
      guildId: '987654321098765432',
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        activation: expect.objectContaining({
          channelId: MOCK_DISCORD_USER_ID,
          personalitySlug: 'test-character',
          personalityName: 'Test Character',
        }),
        replaced: false,
      })
    );
  });

  it('should replace existing activation with new personality', async () => {
    const oldPersonalityId = '550e8400-e29b-41d4-a716-446655440088';
    const personality = createMockPersonality({ isPublic: true });
    // Existing settings with a different personality
    const existingSettings = { activatedPersonalityId: oldPersonalityId };
    const updatedSettings = createMockActivation();

    mockPrisma.personality.findUnique.mockResolvedValue(personality);
    // findUnique now used to check existing settings
    mockPrisma.channelSettings.findUnique.mockResolvedValue(existingSettings);
    mockPrisma.channelSettings.upsert.mockResolvedValue(updatedSettings);

    const router = createChannelRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'post', '/activate');
    const { req, res } = createMockReqRes({
      channelId: MOCK_DISCORD_USER_ID,
      personalitySlug: 'test-character',
      guildId: '987654321098765432',
    });

    await handler(req, res);

    // Uses upsert now, not delete + create
    expect(mockPrisma.channelSettings.upsert).toHaveBeenCalled();

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        replaced: true,
      })
    );
  });

  it('should reject invalid request body', async () => {
    const router = createChannelRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'post', '/activate');
    const { req, res } = createMockReqRes({
      channelId: '', // Invalid - empty string
      personalitySlug: 'test-character',
      guildId: '987654321098765432',
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'VALIDATION_ERROR',
      })
    );
  });

  it('should return 404 for non-existent personality', async () => {
    mockPrisma.personality.findUnique.mockResolvedValue(null);

    const router = createChannelRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'post', '/activate');
    const { req, res } = createMockReqRes({
      channelId: MOCK_DISCORD_USER_ID,
      personalitySlug: 'non-existent',
      guildId: '987654321098765432',
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'NOT_FOUND',
        message: expect.stringContaining('non-existent'),
      })
    );
  });

  it('should reject activation if user cannot access private personality', async () => {
    const otherUserUuid = '550e8400-e29b-41d4-a716-446655440077';
    const privatePersonality = createMockPersonality({
      isPublic: false,
      ownerId: otherUserUuid, // Not the requesting user
    });

    mockPrisma.personality.findUnique.mockResolvedValue(privatePersonality);

    const router = createChannelRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'post', '/activate');
    const { req, res } = createMockReqRes({
      channelId: MOCK_DISCORD_USER_ID,
      personalitySlug: 'private-character',
      guildId: '987654321098765432',
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'UNAUTHORIZED',
      })
    );
  });

  it('should allow bot owner to activate any personality', async () => {
    mockIsBotOwner.mockReturnValue(true);

    const otherUserUuid = '550e8400-e29b-41d4-a716-446655440077';
    const privatePersonality = createMockPersonality({
      isPublic: false,
      ownerId: otherUserUuid,
    });
    const settings = createMockActivation();

    mockPrisma.personality.findUnique.mockResolvedValue(privatePersonality);
    mockPrisma.channelSettings.upsert.mockResolvedValue(settings);

    const router = createChannelRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'post', '/activate');
    const { req, res } = createMockReqRes({
      channelId: MOCK_DISCORD_USER_ID,
      personalitySlug: 'private-character',
      guildId: '987654321098765432',
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('should allow user to activate their own private personality', async () => {
    const ownedPersonality = createMockPersonality({
      isPublic: false,
      ownerId: MOCK_USER_UUID, // Same as user's internal ID
    });
    const settings = createMockActivation();

    mockPrisma.personality.findUnique.mockResolvedValue(ownedPersonality);
    mockPrisma.channelSettings.upsert.mockResolvedValue(settings);

    const router = createChannelRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'post', '/activate');
    const { req, res } = createMockReqRes({
      channelId: MOCK_DISCORD_USER_ID,
      personalitySlug: 'my-private-character',
      guildId: '987654321098765432',
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('should create user if they do not exist', async () => {
    const personality = createMockPersonality({ isPublic: true });
    const settings = createMockActivation();

    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.personality.findUnique.mockResolvedValue(personality);
    mockPrisma.channelSettings.upsert.mockResolvedValue(settings);

    const router = createChannelRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'post', '/activate');
    const { req, res } = createMockReqRes({
      channelId: MOCK_DISCORD_USER_ID,
      personalitySlug: 'test-character',
      guildId: '987654321098765432',
    });

    await handler(req, res);

    // UserService creates users via $transaction, not direct create
    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
