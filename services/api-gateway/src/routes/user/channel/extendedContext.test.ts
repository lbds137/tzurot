/**
 * Tests for PATCH /user/channel/extended-context/:channelId
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createExtendedContextHandler } from './extendedContext.js';
import type { PrismaClient } from '@tzurot/common-types';
import {
  createMockPrisma,
  setupStandardMocks,
  createMockActivation,
  MOCK_USER_UUID,
  MOCK_DISCORD_USER_ID,
  MOCK_ACTIVATION_UUID,
  MOCK_CREATED_AT,
} from './test-utils.js';

// Mock dependencies
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    generateChannelSettingsUuid: () => MOCK_ACTIVATION_UUID,
  };
});

describe('PATCH /user/channel/extended-context/:channelId', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = createMockPrisma();
    setupStandardMocks(mockPrisma);

    app = express();
    app.use(express.json());
    // Inject userId middleware
    app.use((req, _res, next) => {
      (req as express.Request & { userId: string }).userId = MOCK_DISCORD_USER_ID;
      next();
    });
    // Mount handler at the expected path
    const handlers = createExtendedContextHandler(mockPrisma as unknown as PrismaClient);
    // Skip auth middleware (first handler), use actual handler (second)
    app.patch('/extended-context/:channelId', handlers[1]);
    // Add error handler
    app.use(
      (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(500).json({ error: err.message, stack: err.stack });
      }
    );
  });

  it('should enable extended context for a channel', async () => {
    const channelId = '123456789012345678';
    const updatedSettings = createMockActivation({
      channelId,
      extendedContext: true,
    });
    mockPrisma.channelSettings.upsert.mockResolvedValue(updatedSettings);

    const response = await request(app).patch(`/extended-context/${channelId}`).send({
      extendedContext: true,
    });

    expect(response.status).toBe(200);
    expect(response.body.updated).toBe(true);
    expect(response.body.settings.channelId).toBe(channelId);
    expect(response.body.settings.extendedContext).toBe(true);
    expect(mockPrisma.channelSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { channelId },
        update: { extendedContext: true },
      })
    );
  });

  it('should disable extended context for a channel', async () => {
    const channelId = '123456789012345678';
    const updatedSettings = createMockActivation({
      channelId,
      extendedContext: false,
    });
    mockPrisma.channelSettings.upsert.mockResolvedValue(updatedSettings);

    const response = await request(app).patch(`/extended-context/${channelId}`).send({
      extendedContext: false,
    });

    expect(response.status).toBe(200);
    expect(response.body.updated).toBe(true);
    expect(response.body.settings.extendedContext).toBe(false);
  });

  it('should set extended context to null (use global default)', async () => {
    const channelId = '123456789012345678';
    const updatedSettings = createMockActivation({
      channelId,
      extendedContext: null,
    });
    mockPrisma.channelSettings.upsert.mockResolvedValue(updatedSettings);

    const response = await request(app).patch(`/extended-context/${channelId}`).send({
      extendedContext: null,
    });

    expect(response.status).toBe(200);
    expect(response.body.updated).toBe(true);
    expect(response.body.settings.extendedContext).toBe(null);
  });

  it('should create settings record if it does not exist', async () => {
    const channelId = '123456789012345678';
    // New settings record without personality
    const newSettings = {
      id: MOCK_ACTIVATION_UUID,
      channelId,
      guildId: null,
      createdBy: MOCK_USER_UUID,
      createdAt: MOCK_CREATED_AT,
      autoRespond: true,
      extendedContext: true,
      activatedPersonalityId: null,
      activatedPersonality: null,
    };
    mockPrisma.channelSettings.upsert.mockResolvedValue(newSettings);

    const response = await request(app).patch(`/extended-context/${channelId}`).send({
      extendedContext: true,
    });

    expect(response.status).toBe(200);
    expect(response.body.updated).toBe(true);
    expect(response.body.settings.personalitySlug).toBe(null);
    expect(response.body.settings.personalityName).toBe(null);
    expect(response.body.settings.extendedContext).toBe(true);
    expect(mockPrisma.channelSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          channelId,
          extendedContext: true,
          createdBy: MOCK_USER_UUID,
        }),
      })
    );
  });

  it('should reject invalid request body (missing extendedContext)', async () => {
    const channelId = '123456789012345678';

    const response = await request(app).patch(`/extended-context/${channelId}`).send({
      // Missing extendedContext field
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VALIDATION_ERROR');
    expect(mockPrisma.channelSettings.upsert).not.toHaveBeenCalled();
  });

  it('should reject invalid extendedContext value type', async () => {
    const channelId = '123456789012345678';

    const response = await request(app).patch(`/extended-context/${channelId}`).send({
      extendedContext: 'yes', // Should be boolean or null
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VALIDATION_ERROR');
  });
});
