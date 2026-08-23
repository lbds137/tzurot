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

  /**
   * Stand-in for the broadcast half of the invalidation. `RouteDeps` types this
   * as the real `ChannelActivationCacheInvalidationService`, so the cast keeps
   * the seam asserted without constructing a Redis-backed service.
   */
  function createChannelActivationInvalidation(): { invalidateChannel: ReturnType<typeof vi.fn> } {
    return { invalidateChannel: vi.fn().mockResolvedValue(undefined) };
  }

  /** The bare handler export — the shape routes/_generated/mounts.ts mounts. */
  const getDeactivateHandler = (
    channelActivationInvalidation?: ReturnType<typeof createChannelActivationInvalidation>
  ): ReturnType<typeof asRouteHandler> =>
    asRouteHandler(
      handleDeactivateChannel({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
        channelActivationInvalidation: channelActivationInvalidation as unknown as Parameters<
          typeof handleDeactivateChannel
        >[0]['channelActivationInvalidation'],
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

  describe('channel-activation cache invalidation', () => {
    it('broadcasts the deactivated channelId', async () => {
      const existingSettings = createMockActivation();
      mockPrisma.channelSettings.findUnique.mockResolvedValue(existingSettings);
      const channelActivationInvalidation = createChannelActivationInvalidation();

      const handler = getDeactivateHandler(channelActivationInvalidation);
      const { req, res } = createMockReqRes({ channelId: MOCK_DISCORD_USER_ID });
      await handler(req, res);

      expect(channelActivationInvalidation.invalidateChannel).toHaveBeenCalledWith(
        MOCK_DISCORD_USER_ID
      );
    });

    it('does NOT broadcast on the no-op path (nothing was activated)', async () => {
      mockPrisma.channelSettings.findUnique.mockResolvedValue(null);
      const channelActivationInvalidation = createChannelActivationInvalidation();

      const handler = getDeactivateHandler(channelActivationInvalidation);
      const { req, res } = createMockReqRes({ channelId: MOCK_DISCORD_USER_ID });
      await handler(req, res);

      expect(channelActivationInvalidation.invalidateChannel).not.toHaveBeenCalled();
    });

    it('still succeeds when the broadcast rejects', async () => {
      const existingSettings = createMockActivation();
      mockPrisma.channelSettings.findUnique.mockResolvedValue(existingSettings);
      const channelActivationInvalidation = createChannelActivationInvalidation();
      channelActivationInvalidation.invalidateChannel.mockRejectedValue(new Error('redis down'));

      const handler = getDeactivateHandler(channelActivationInvalidation);
      const { req, res } = createMockReqRes({ channelId: MOCK_DISCORD_USER_ID });
      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ deactivated: true }));
    });
  });
});
