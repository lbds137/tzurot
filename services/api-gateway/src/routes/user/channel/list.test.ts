/**
 * Tests for GET /user/channel/list
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types';
import {
  createMockPrisma,
  createMockReqRes,
  createMockActivation,
  getHandler,
  setupStandardMocks,
  createMockCreatedAt,
  MOCK_USER_UUID,
  MOCK_ACTIVATION_UUID,
  MOCK_DISCORD_USER_ID,
  MOCK_GUILD_ID,
} from './test-utils.js';

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
  requireServiceAuth: vi.fn(() =>
    vi.fn((_req: unknown, _res: unknown, next: () => void) => next())
  ),
}));

vi.mock('../../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

import { createChannelRoutes } from './index.js';

describe('GET /user/channel/list', () => {
  const mockPrisma = createMockPrisma();

  beforeEach(() => {
    vi.clearAllMocks();
    setupStandardMocks(mockPrisma);
  });

  it('should return list of activations', async () => {
    const activation1Id = '550e8400-e29b-41d4-a716-446655440011';
    const activation2Id = '550e8400-e29b-41d4-a716-446655440022';
    const activations = [
      createMockActivation({
        id: activation1Id,
        channelId: '111111111111111111',
        activatedPersonality: { slug: 'char-one', displayName: 'Character One' },
      }),
      createMockActivation({
        id: activation2Id,
        channelId: '222222222222222222',
        activatedPersonality: { slug: 'char-two', displayName: 'Character Two' },
      }),
    ];
    mockPrisma.channelSettings.findMany.mockResolvedValue(activations);

    const router = createChannelRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'get', '/list');
    const { req, res } = createMockReqRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.arrayContaining([
          expect.objectContaining({
            id: activation1Id,
            channelId: '111111111111111111',
            personalitySlug: 'char-one',
            personalityName: 'Character One',
          }),
          expect.objectContaining({
            id: activation2Id,
            channelId: '222222222222222222',
            personalitySlug: 'char-two',
            personalityName: 'Character Two',
          }),
        ]),
      })
    );
  });

  it('should return empty array when no activations exist', async () => {
    mockPrisma.channelSettings.findMany.mockResolvedValue([]);

    const router = createChannelRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'get', '/list');
    const { req, res } = createMockReqRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      settings: [],
    });
  });

  it('should include all activation fields in response', async () => {
    const activation = createMockActivation();
    mockPrisma.channelSettings.findMany.mockResolvedValue([activation]);

    const router = createChannelRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'get', '/list');
    const { req, res } = createMockReqRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      settings: [
        {
          id: MOCK_ACTIVATION_UUID,
          channelId: MOCK_DISCORD_USER_ID,
          guildId: MOCK_GUILD_ID,
          personalitySlug: 'test-character',
          personalityName: 'Test Character',
          autoRespond: true,
          extendedContext: false,
          extendedContextMaxMessages: null,
          extendedContextMaxAge: null,
          extendedContextMaxImages: null,
          activatedBy: MOCK_USER_UUID,
          createdAt: createMockCreatedAt().toISOString(),
        },
      ],
    });
  });

  it('should filter by guildId when query param provided', async () => {
    const activation = createMockActivation();
    mockPrisma.channelSettings.findMany.mockResolvedValue([activation]);

    const router = createChannelRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'get', '/list');
    const { req, res } = createMockReqRes({}, {}, { guildId: MOCK_GUILD_ID });

    await handler(req, res);

    // Should include records with matching guildId OR null guildId (for backfill)
    // and only those with activated personalities
    expect(mockPrisma.channelSettings.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          activatedPersonalityId: { not: null },
          OR: [{ guildId: MOCK_GUILD_ID }, { guildId: null }],
        },
      })
    );
  });

  it('should only return channels with activated personalities', async () => {
    mockPrisma.channelSettings.findMany.mockResolvedValue([]);

    const router = createChannelRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'get', '/list');
    const { req, res } = createMockReqRes();

    await handler(req, res);

    // Should filter to only activated channels (with personalityId set)
    expect(mockPrisma.channelSettings.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          activatedPersonalityId: { not: null },
        },
      })
    );
  });

  it('should handle activation with null createdBy', async () => {
    const activation = createMockActivation({ createdBy: null });
    mockPrisma.channelSettings.findMany.mockResolvedValue([activation]);

    const router = createChannelRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'get', '/list');
    const { req, res } = createMockReqRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: [
          expect.objectContaining({
            activatedBy: null,
          }),
        ],
      })
    );
  });

  it('should order activations by createdAt descending', async () => {
    const router = createChannelRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'get', '/list');
    const { req, res } = createMockReqRes();

    await handler(req, res);

    expect(mockPrisma.channelSettings.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: 'desc' },
      })
    );
  });
});
