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
  createMockCreatedAt,
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

  it('should return settings when channel has settings', async () => {
    const settings = createMockActivation();
    mockPrisma.channelSettings.findUnique.mockResolvedValue(settings);

    const router = createChannelRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'get', '/:channelId');
    const { req, res } = createMockReqRes({}, { channelId: MOCK_DISCORD_USER_ID });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        hasSettings: true,
        settings: expect.objectContaining({
          channelId: MOCK_DISCORD_USER_ID,
          personalitySlug: 'test-character',
          personalityName: 'Test Character',
          autoRespond: true,
          extendedContext: false,
          activatedBy: MOCK_USER_UUID,
          createdAt: createMockCreatedAt().toISOString(),
        }),
      })
    );
  });

  it('should return hasSettings=false when channel has no settings', async () => {
    mockPrisma.channelSettings.findUnique.mockResolvedValue(null);

    const router = createChannelRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'get', '/:channelId');
    const { req, res } = createMockReqRes({}, { channelId: MOCK_DISCORD_USER_ID });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      hasSettings: false,
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

  it('should handle settings with null createdBy', async () => {
    const settingsWithNullCreator = createMockActivation({
      createdBy: null,
    });
    mockPrisma.channelSettings.findUnique.mockResolvedValue(settingsWithNullCreator);

    const router = createChannelRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'get', '/:channelId');
    const { req, res } = createMockReqRes({}, { channelId: MOCK_DISCORD_USER_ID });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        hasSettings: true,
        settings: expect.objectContaining({
          activatedBy: null,
        }),
      })
    );
  });
});
