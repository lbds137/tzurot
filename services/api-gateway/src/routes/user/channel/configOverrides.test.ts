/**
 * Tests for channel config overrides routes
 * PATCH/GET/DELETE /user/channel/:channelId/config-overrides
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma, type PrismaClient } from '@tzurot/common-types/services/prisma';
import express from 'express';
import request from 'supertest';
import {
  handleGetChannelConfigOverrides,
  handleUpdateChannelConfigOverrides,
  handleClearChannelConfigOverrides,
} from './configOverrides.js';
import type { RouteDeps } from '../../routeDeps.js';
import { createMockPrisma, setupStandardMocks } from './test-utils.js';
import { stubRouteResolvers } from '../../../test/shared-route-test-utils.js';

const CHANNEL_ID = '999888777666555444';

/**
 * Mount the bare handler exports — the shape routes/_generated/mounts.ts
 * mounts — on the paths it serves them at, minus the `/api` prefix the
 * request URLs below omit.
 */
function buildApp(deps: RouteDeps): express.Express {
  const app = express();
  app.use(express.json());
  const path = '/user/channel/:channelId/config-overrides';
  app.get(path, handleGetChannelConfigOverrides(deps));
  app.patch(path, handleUpdateChannelConfigOverrides(deps));
  app.delete(path, handleClearChannelConfigOverrides(deps));
  return app;
}

describe('Channel Config Overrides Routes', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = createMockPrisma();
    setupStandardMocks(mockPrisma);

    app = buildApp({
      ...stubRouteResolvers(),
      prisma: mockPrisma as unknown as PrismaClient,
    });
  });

  describe('channelId validation', () => {
    it('should reject invalid channelId format', async () => {
      const response = await request(app).get('/user/channel/not-a-snowflake/config-overrides');

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid channelId');
    });

    it('should reject channelId with non-numeric characters', async () => {
      const response = await request(app)
        .patch('/user/channel/abc123/config-overrides')
        .send({ maxMessages: 10 });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/user/channel/:channelId/config-overrides', () => {
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

  describe('PATCH /api/user/channel/:channelId/config-overrides', () => {
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

      const appWithInvalidation = buildApp({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
        cascadeInvalidation: mockInvalidation as never,
      });

      await request(appWithInvalidation)
        .patch(`/user/channel/${CHANNEL_ID}/config-overrides`)
        .send({ maxMessages: 25 });

      expect(mockInvalidation.invalidateChannel).toHaveBeenCalledWith(CHANNEL_ID);
    });
  });

  describe('PATCH /api/user/channel/:channelId/config-overrides (cascade invalidation)', () => {
    it('should swallow cascade invalidation errors', async () => {
      mockPrisma.channelSettings.findUnique.mockResolvedValue(null);
      mockPrisma.channelSettings.upsert.mockResolvedValue({});

      const mockInvalidation = {
        invalidateChannel: vi.fn().mockRejectedValue(new Error('Redis down')),
      };

      const appWithInvalidation = buildApp({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
        cascadeInvalidation: mockInvalidation as never,
      });

      const response = await request(appWithInvalidation)
        .patch(`/user/channel/${CHANNEL_ID}/config-overrides`)
        .send({ maxMessages: 25 });

      // Should still succeed even though invalidation failed
      expect(response.status).toBe(200);
      expect(mockInvalidation.invalidateChannel).toHaveBeenCalledWith(CHANNEL_ID);
    });
  });

  describe('DELETE /api/user/channel/:channelId/config-overrides (cascade invalidation)', () => {
    it('should swallow cascade invalidation errors on delete', async () => {
      mockPrisma.channelSettings.updateMany.mockResolvedValue({ count: 1 });

      const mockInvalidation = {
        invalidateChannel: vi.fn().mockRejectedValue(new Error('Redis down')),
      };

      const appWithInvalidation = buildApp({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
        cascadeInvalidation: mockInvalidation as never,
      });

      const response = await request(appWithInvalidation).delete(
        `/user/channel/${CHANNEL_ID}/config-overrides`
      );

      // Should still succeed even though invalidation failed
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('DELETE /api/user/channel/:channelId/config-overrides', () => {
    it('should clear overrides via updateMany', async () => {
      mockPrisma.channelSettings.updateMany.mockResolvedValue({ count: 1 });

      const response = await request(app).delete(`/user/channel/${CHANNEL_ID}/config-overrides`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockPrisma.channelSettings.updateMany).toHaveBeenCalledWith({
        where: { channelId: CHANNEL_ID },
        data: { configOverrides: Prisma.JsonNull },
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
