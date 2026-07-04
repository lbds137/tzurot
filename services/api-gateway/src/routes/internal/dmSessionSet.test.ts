/**
 * Tests for POST /internal/channel/dm-session/set
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { handleSetDmSession } from './dmSessionSet.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

describe('POST /internal/channel/dm-session/set', () => {
  let mockPrisma: {
    personality: { findUnique: ReturnType<typeof vi.fn> };
    channelSettings: { upsert: ReturnType<typeof vi.fn> };
  };
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = {
      personality: { findUnique: vi.fn() },
      channelSettings: { upsert: vi.fn() },
    };
    app = express();
    app.use(express.json());
    app.post(
      '/internal/channel/dm-session/set',
      handleSetDmSession({ prisma: mockPrisma as unknown as PrismaClient })
    );
  });

  it('upserts channel_settings with guildId=null and resolved personality id', async () => {
    mockPrisma.personality.findUnique.mockResolvedValue({ id: 'pid-alice' });
    mockPrisma.channelSettings.upsert.mockResolvedValue({});

    const response = await request(app)
      .post('/internal/channel/dm-session/set')
      .send({ channelId: 'dm-channel-123', personalitySlug: 'alice' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      channelId: 'dm-channel-123',
      personalitySlug: 'alice',
    });

    const upsertCall = mockPrisma.channelSettings.upsert.mock.calls[0][0];
    expect(upsertCall.where).toEqual({ channelId: 'dm-channel-123' });
    expect(upsertCall.create.guildId).toBeNull();
    expect(upsertCall.create.activatedPersonalityId).toBe('pid-alice');
    // guildId is intentionally NOT in the update clause — it's always null
    // for DM channels (set at row creation) and overwriting it would be
    // misleading.
    expect(upsertCall.update).toEqual({ activatedPersonalityId: 'pid-alice' });
  });

  it('returns 404 when personality slug is not found', async () => {
    mockPrisma.personality.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .post('/internal/channel/dm-session/set')
      .send({ channelId: 'dm-channel-123', personalitySlug: 'ghost' });

    expect(response.status).toBe(404);
    expect(mockPrisma.channelSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects missing channelId with Zod validation', async () => {
    const response = await request(app)
      .post('/internal/channel/dm-session/set')
      .send({ personalitySlug: 'alice' });

    expect(response.status).toBe(400);
  });

  it('rejects empty personalitySlug', async () => {
    const response = await request(app)
      .post('/internal/channel/dm-session/set')
      .send({ channelId: 'dm-channel-123', personalitySlug: '' });

    expect(response.status).toBe(400);
  });

  it('is idempotent across repeated calls (upsert handles existing rows)', async () => {
    mockPrisma.personality.findUnique.mockResolvedValue({ id: 'pid-alice' });
    mockPrisma.channelSettings.upsert.mockResolvedValue({});

    await request(app)
      .post('/internal/channel/dm-session/set')
      .send({ channelId: 'dm-channel-123', personalitySlug: 'alice' });
    await request(app)
      .post('/internal/channel/dm-session/set')
      .send({ channelId: 'dm-channel-123', personalitySlug: 'alice' });

    expect(mockPrisma.channelSettings.upsert).toHaveBeenCalledTimes(2);
  });

  it('surfaces a 500 when Prisma throws during the upsert', async () => {
    // asyncHandler propagates unhandled errors to Express error middleware,
    // which produces a 500. Locking this in so a future refactor doesn't
    // accidentally swallow the error.
    mockPrisma.personality.findUnique.mockResolvedValue({ id: 'pid-alice' });
    mockPrisma.channelSettings.upsert.mockRejectedValue(new Error('Prisma exploded'));

    const response = await request(app)
      .post('/internal/channel/dm-session/set')
      .send({ channelId: 'dm-channel-123', personalitySlug: 'alice' });

    expect(response.status).toBe(500);
  });
});
