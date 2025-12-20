/**
 * Tests for PATCH /user/channel/update-guild
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types';
import {
  createMockPrisma,
  createMockReqRes,
  getHandler,
  setupStandardMocks,
  MOCK_GUILD_ID,
  MOCK_DISCORD_USER_ID,
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

describe('PATCH /user/channel/update-guild', () => {
  const mockPrisma = createMockPrisma();

  beforeEach(() => {
    vi.clearAllMocks();
    setupStandardMocks(mockPrisma);
  });

  it('should update guildId when activation has null guildId', async () => {
    mockPrisma.activatedChannel.updateMany.mockResolvedValue({ count: 1 });

    const router = createChannelRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'patch', '/update-guild');
    const { req, res } = createMockReqRes({
      channelId: MOCK_DISCORD_USER_ID,
      guildId: MOCK_GUILD_ID,
    });

    await handler(req, res);

    expect(mockPrisma.activatedChannel.updateMany).toHaveBeenCalledWith({
      where: {
        channelId: MOCK_DISCORD_USER_ID,
        guildId: null,
      },
      data: { guildId: MOCK_GUILD_ID },
    });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ updated: true });
  });

  it('should return updated=false when no activation needs updating', async () => {
    mockPrisma.activatedChannel.updateMany.mockResolvedValue({ count: 0 });

    const router = createChannelRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'patch', '/update-guild');
    const { req, res } = createMockReqRes({
      channelId: MOCK_DISCORD_USER_ID,
      guildId: MOCK_GUILD_ID,
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ updated: false });
  });

  it('should reject empty channelId', async () => {
    const router = createChannelRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'patch', '/update-guild');
    const { req, res } = createMockReqRes({
      channelId: '',
      guildId: MOCK_GUILD_ID,
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'VALIDATION_ERROR',
      })
    );
    expect(mockPrisma.activatedChannel.updateMany).not.toHaveBeenCalled();
  });

  it('should reject empty guildId', async () => {
    const router = createChannelRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'patch', '/update-guild');
    const { req, res } = createMockReqRes({
      channelId: MOCK_DISCORD_USER_ID,
      guildId: '',
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'VALIDATION_ERROR',
      })
    );
    expect(mockPrisma.activatedChannel.updateMany).not.toHaveBeenCalled();
  });

  it('should reject missing fields', async () => {
    const router = createChannelRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'patch', '/update-guild');
    const { req, res } = createMockReqRes({});

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'VALIDATION_ERROR',
      })
    );
  });
});
