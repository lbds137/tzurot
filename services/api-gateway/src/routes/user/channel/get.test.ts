/**
 * Tests for GET /user/channel/:channelId
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types';
import {
  createMockPrisma,
  createMockReqRes,
  createMockActivation,
  getHandler,
  setupStandardMocks,
  MOCK_CREATED_AT,
  MOCK_USER_UUID,
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

describe('GET /user/channel/:channelId', () => {
  const mockPrisma = createMockPrisma();

  beforeEach(() => {
    vi.clearAllMocks();
    setupStandardMocks(mockPrisma);
  });

  it('should return activation status when channel is activated', async () => {
    const activation = createMockActivation();
    mockPrisma.activatedChannel.findFirst.mockResolvedValue(activation);

    const router = createChannelRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'get', '/:channelId');
    const { req, res } = createMockReqRes({}, { channelId: MOCK_DISCORD_USER_ID });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        isActivated: true,
        activation: expect.objectContaining({
          channelId: MOCK_DISCORD_USER_ID,
          personalitySlug: 'test-character',
          personalityName: 'Test Character',
          activatedBy: MOCK_USER_UUID,
          createdAt: MOCK_CREATED_AT.toISOString(),
        }),
      })
    );
  });

  it('should return isActivated=false when channel has no activation', async () => {
    mockPrisma.activatedChannel.findFirst.mockResolvedValue(null);

    const router = createChannelRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'get', '/:channelId');
    const { req, res } = createMockReqRes({}, { channelId: MOCK_DISCORD_USER_ID });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      isActivated: false,
    });
  });

  it('should reject empty channelId', async () => {
    const router = createChannelRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'get', '/:channelId');
    const { req, res } = createMockReqRes({}, { channelId: '' });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'VALIDATION_ERROR',
      })
    );
  });

  it('should handle activation with null createdBy', async () => {
    const activationWithNullCreator = createMockActivation({
      createdBy: null,
    });
    mockPrisma.activatedChannel.findFirst.mockResolvedValue(activationWithNullCreator);

    const router = createChannelRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'get', '/:channelId');
    const { req, res } = createMockReqRes({}, { channelId: MOCK_DISCORD_USER_ID });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        isActivated: true,
        activation: expect.objectContaining({
          activatedBy: null,
        }),
      })
    );
  });
});
