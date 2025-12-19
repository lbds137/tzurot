/**
 * Tests for DELETE /user/channel/deactivate
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types';
import {
  createMockPrisma,
  createMockReqRes,
  createMockActivation,
  getHandler,
  setupStandardMocks,
  MOCK_ACTIVATION_UUID,
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

describe('DELETE /user/channel/deactivate', () => {
  const mockPrisma = createMockPrisma();

  beforeEach(() => {
    vi.clearAllMocks();
    setupStandardMocks(mockPrisma);
  });

  it('should deactivate an existing activation', async () => {
    const existingActivation = createMockActivation();
    mockPrisma.activatedChannel.findFirst.mockResolvedValue(existingActivation);

    const router = createChannelRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'delete', '/deactivate');
    const { req, res } = createMockReqRes({
      channelId: MOCK_DISCORD_USER_ID,
    });

    await handler(req, res);

    expect(mockPrisma.activatedChannel.delete).toHaveBeenCalledWith({
      where: { id: MOCK_ACTIVATION_UUID },
    });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        deactivated: true,
        personalityName: 'Test Character',
      })
    );
  });

  it('should return deactivated=false when no activation exists', async () => {
    mockPrisma.activatedChannel.findFirst.mockResolvedValue(null);

    const router = createChannelRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'delete', '/deactivate');
    const { req, res } = createMockReqRes({
      channelId: MOCK_DISCORD_USER_ID,
    });

    await handler(req, res);

    expect(mockPrisma.activatedChannel.delete).not.toHaveBeenCalled();

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      deactivated: false,
    });
  });

  it('should reject invalid request body', async () => {
    const router = createChannelRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'delete', '/deactivate');
    const { req, res } = createMockReqRes({
      channelId: '', // Invalid - empty string
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'VALIDATION_ERROR',
      })
    );
  });

  it('should reject missing channelId', async () => {
    const router = createChannelRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'delete', '/deactivate');
    const { req, res } = createMockReqRes({}); // Missing channelId

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'VALIDATION_ERROR',
      })
    );
  });
});
