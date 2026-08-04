/**
 * Tests for PATCH /user/channel/update-guild
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  createMockPrisma,
  createMockReqRes,
  setupStandardMocks,
  MOCK_GUILD_ID,
  MOCK_DISCORD_USER_ID,
} from './test-utils.js';

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

vi.mock('../../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

import { handleUpdateChannelGuild } from './updateGuild.js';
import { asRouteHandler, stubRouteResolvers } from '../../../test/shared-route-test-utils.js';

describe('PATCH /api/user/channel/update-guild', () => {
  const mockPrisma = createMockPrisma();

  /** The bare handler export — the shape routes/_generated/mounts.ts mounts. */
  const getUpdateGuildHandler = (): ReturnType<typeof asRouteHandler> =>
    asRouteHandler(
      handleUpdateChannelGuild({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      })
    );

  beforeEach(() => {
    vi.clearAllMocks();
    setupStandardMocks(mockPrisma);
  });

  it('should update guildId when activation has null guildId', async () => {
    mockPrisma.channelSettings.updateMany.mockResolvedValue({ count: 1 });

    const handler = getUpdateGuildHandler();
    const { req, res } = createMockReqRes({
      channelId: MOCK_DISCORD_USER_ID,
      guildId: MOCK_GUILD_ID,
    });

    await handler(req, res);

    expect(mockPrisma.channelSettings.updateMany).toHaveBeenCalledWith({
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
    mockPrisma.channelSettings.updateMany.mockResolvedValue({ count: 0 });

    const handler = getUpdateGuildHandler();
    const { req, res } = createMockReqRes({
      channelId: MOCK_DISCORD_USER_ID,
      guildId: MOCK_GUILD_ID,
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ updated: false });
  });

  it('should reject empty channelId', async () => {
    const handler = getUpdateGuildHandler();
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
    expect(mockPrisma.channelSettings.updateMany).not.toHaveBeenCalled();
  });

  it('should reject empty guildId', async () => {
    const handler = getUpdateGuildHandler();
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
    expect(mockPrisma.channelSettings.updateMany).not.toHaveBeenCalled();
  });

  it('should reject missing fields', async () => {
    const handler = getUpdateGuildHandler();
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
