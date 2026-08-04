/**
 * Tests for DELETE /user/channel/deactivate
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  createMockPrisma,
  createMockReqRes,
  createMockActivation,
  setupStandardMocks,
  MOCK_ACTIVATION_UUID,
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

import { handleDeactivateChannel } from './deactivate.js';
import { asRouteHandler, stubRouteResolvers } from '../../../test/shared-route-test-utils.js';

describe('DELETE /api/user/channel/deactivate', () => {
  const mockPrisma = createMockPrisma();

  /** The bare handler export — the shape routes/_generated/mounts.ts mounts. */
  const getDeactivateHandler = (): ReturnType<typeof asRouteHandler> =>
    asRouteHandler(
      handleDeactivateChannel({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      })
    );

  beforeEach(() => {
    vi.clearAllMocks();
    setupStandardMocks(mockPrisma);
  });

  it('should deactivate an existing activation', async () => {
    const existingSettings = createMockActivation();
    mockPrisma.channelSettings.findUnique.mockResolvedValue(existingSettings);

    const handler = getDeactivateHandler();
    const { req, res } = createMockReqRes({
      channelId: MOCK_DISCORD_USER_ID,
    });

    await handler(req, res);

    expect(mockPrisma.channelSettings.update).toHaveBeenCalledWith({
      where: { id: MOCK_ACTIVATION_UUID },
      data: { activatedPersonalityId: null },
    });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        deactivated: true,
        personalityName: 'Test Character',
      })
    );
  });

  it('should return deactivated=false when no settings exist', async () => {
    mockPrisma.channelSettings.findUnique.mockResolvedValue(null);

    const handler = getDeactivateHandler();
    const { req, res } = createMockReqRes({
      channelId: MOCK_DISCORD_USER_ID,
    });

    await handler(req, res);

    expect(mockPrisma.channelSettings.update).not.toHaveBeenCalled();

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      deactivated: false,
    });
  });

  it('should reject invalid request body', async () => {
    const handler = getDeactivateHandler();
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
    const handler = getDeactivateHandler();
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
