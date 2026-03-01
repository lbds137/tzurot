/**
 * Tests for channel config overrides routes
 * PATCH/GET/DELETE /user/channel/:channelId/config-overrides
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types';
import express from 'express';
import request from 'supertest';
import { createChannelRoutes } from './index.js';
import { createMockPrisma, setupStandardMocks, MOCK_DISCORD_USER_ID } from './test-utils.js';

// Mock AuthMiddleware
vi.mock('../../../services/AuthMiddleware.js', () => ({
  requireUserAuth: () => (req: { userId?: string }, _res: unknown, next: () => void) => {
    req.userId = MOCK_DISCORD_USER_ID;
    next();
  },
  requireServiceAuth: () => (req: { userId?: string }, _res: unknown, next: () => void) => {
    req.userId = 'service';
    next();
  },
}));

// Mock isBotOwner
vi.mock('@tzurot/common-types', async () => {
  const actual =
    await vi.importActual<typeof import('@tzurot/common-types')>('@tzurot/common-types');
  return {
    ...actual,
    isBotOwner: vi.fn().mockReturnValue(false),
  };
});

const CHANNEL_ID = '999888777666555444';

describe('Channel Config Overrides Routes', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = createMockPrisma();
    setupStandardMocks(mockPrisma);

    app = express();
    app.use(express.json());
    app.use('/user/channel', createChannelRoutes(mockPrisma as unknown as PrismaClient));
  });

  describe('GET /:channelId/config-overrides', () => {
    it('should return null when no overrides exist', async () => {
      mockPrisma.channelSettings.findUnique.mockResolvedValue(null);

      const response = await request(app).get(`/user/channel/${CHANNEL_ID}/config-overrides`);

      expect(response.status).toBe(200);
      expect(response.body.configOverrides).toBeNull();
    });

    it('should return existing overrides', async () => {
      const overrides = { maxMessages: 30, maxImages: 5 };
      mockPrisma.channelSettings.findUnique.mockResolvedValue({
        configOverrides: overrides,
      });

      const response = await request(app).get(`/user/channel/${CHANNEL_ID}/config-overrides`);

      expect(response.status).toBe(200);
      expect(response.body.configOverrides).toEqual(overrides);
    });
  });

  describe('PATCH /:channelId/config-overrides', () => {
    it('should merge valid overrides', async () => {
      mockPrisma.channelSettings.findUnique.mockResolvedValue({
        configOverrides: { maxMessages: 30 },
      });
      mockPrisma.channelSettings.upsert.mockResolvedValue({});

      const response = await request(app)
        .patch(`/user/channel/${CHANNEL_ID}/config-overrides`)
        .send({ maxImages: 5 });

      expect(response.status).toBe(200);
      expect(response.body.configOverrides).toEqual({ maxMessages: 30, maxImages: 5 });
    });

    it('should clear individual override when field value is null', async () => {
      mockPrisma.channelSettings.findUnique.mockResolvedValue({
        configOverrides: { maxMessages: 30, maxImages: 5 },
      });
      mockPrisma.channelSettings.upsert.mockResolvedValue({});

      const response = await request(app)
        .patch(`/user/channel/${CHANNEL_ID}/config-overrides`)
        .send({ maxMessages: null });

      expect(response.status).toBe(200);
      // mergeConfigOverrides removes null fields, keeping only maxImages
      expect(response.body.configOverrides).toEqual({ maxImages: 5 });
    });

    it('should reject invalid config format', async () => {
      mockPrisma.channelSettings.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .patch(`/user/channel/${CHANNEL_ID}/config-overrides`)
        .send({ maxMessages: 'not-a-number' });

      expect(response.status).toBe(400);
    });

    it('should publish cascade invalidation', async () => {
      mockPrisma.channelSettings.findUnique.mockResolvedValue(null);
      mockPrisma.channelSettings.upsert.mockResolvedValue({});

      const mockInvalidation = {
        invalidateChannel: vi.fn().mockResolvedValue(undefined),
      };

      const appWithInvalidation = express();
      appWithInvalidation.use(express.json());
      appWithInvalidation.use(
        '/user/channel',
        createChannelRoutes(mockPrisma as unknown as PrismaClient, mockInvalidation as never)
      );

      await request(appWithInvalidation)
        .patch(`/user/channel/${CHANNEL_ID}/config-overrides`)
        .send({ maxMessages: 25 });

      expect(mockInvalidation.invalidateChannel).toHaveBeenCalledWith(CHANNEL_ID);
    });
  });

  describe('PATCH /:channelId/config-overrides (cascade invalidation)', () => {
    it('should swallow cascade invalidation errors', async () => {
      mockPrisma.channelSettings.findUnique.mockResolvedValue(null);
      mockPrisma.channelSettings.upsert.mockResolvedValue({});

      const mockInvalidation = {
        invalidateChannel: vi.fn().mockRejectedValue(new Error('Redis down')),
      };

      const appWithInvalidation = express();
      appWithInvalidation.use(express.json());
      appWithInvalidation.use(
        '/user/channel',
        createChannelRoutes(mockPrisma as unknown as PrismaClient, mockInvalidation as never)
      );

      const response = await request(appWithInvalidation)
        .patch(`/user/channel/${CHANNEL_ID}/config-overrides`)
        .send({ maxMessages: 25 });

      // Should still succeed even though invalidation failed
      expect(response.status).toBe(200);
      expect(mockInvalidation.invalidateChannel).toHaveBeenCalledWith(CHANNEL_ID);
    });
  });

  describe('DELETE /:channelId/config-overrides (cascade invalidation)', () => {
    it('should swallow cascade invalidation errors on delete', async () => {
      mockPrisma.channelSettings.updateMany.mockResolvedValue({ count: 1 });

      const mockInvalidation = {
        invalidateChannel: vi.fn().mockRejectedValue(new Error('Redis down')),
      };

      const appWithInvalidation = express();
      appWithInvalidation.use(express.json());
      appWithInvalidation.use(
        '/user/channel',
        createChannelRoutes(mockPrisma as unknown as PrismaClient, mockInvalidation as never)
      );

      const response = await request(appWithInvalidation).delete(
        `/user/channel/${CHANNEL_ID}/config-overrides`
      );

      // Should still succeed even though invalidation failed
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('DELETE /:channelId/config-overrides', () => {
    it('should clear overrides via updateMany', async () => {
      mockPrisma.channelSettings.updateMany.mockResolvedValue({ count: 1 });

      const response = await request(app).delete(`/user/channel/${CHANNEL_ID}/config-overrides`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockPrisma.channelSettings.updateMany).toHaveBeenCalledWith({
        where: { channelId: CHANNEL_ID },
        data: { configOverrides: expect.anything() },
      });
    });

    it('should succeed when no matching rows exist', async () => {
      mockPrisma.channelSettings.updateMany.mockResolvedValue({ count: 0 });

      const response = await request(app).delete(`/user/channel/${CHANNEL_ID}/config-overrides`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });
});
