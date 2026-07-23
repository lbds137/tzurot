/**
 * Tests for POST /internal/users/activity
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { handleStampUserActivity } from './usersActivity.js';
import { stubRouteResolvers } from '../../test/shared-route-test-utils.js';

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

const VALID_DISCORD_ID = '123456789012345678';

describe('POST /internal/users/activity', () => {
  let mockPrisma: { $executeRaw: ReturnType<typeof vi.fn> };
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = { $executeRaw: vi.fn() };
    app = express();
    app.use(express.json());
    app.post(
      '/internal/users/activity',
      handleStampUserActivity({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      })
    );
  });

  it('stamps last_active_at + clears dm_undeliverable_since by discord_id, off updated_at', async () => {
    mockPrisma.$executeRaw.mockResolvedValue(1); // one row updated

    const response = await request(app)
      .post('/internal/users/activity')
      .send({ discordId: VALID_DISCORD_ID });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ stamped: true });

    // The retention signals cross the seam as a RAW UPDATE keyed by discord_id;
    // updated_at must stay untouched (it's the dev<->prod sync LWW resolver).
    const [template, discordId] = mockPrisma.$executeRaw.mock.calls[0] as [string[], string];
    const sql = template.join('');
    expect(sql).toContain('last_active_at');
    expect(sql).toContain('dm_undeliverable_since');
    expect(sql).toContain('discord_id');
    expect(sql).not.toContain('updated_at');
    expect(discordId).toBe(VALID_DISCORD_ID);
  });

  it('reports stamped:false when the user is not provisioned yet (0 rows updated)', async () => {
    mockPrisma.$executeRaw.mockResolvedValue(0); // no matching row — pure-client-only user

    const response = await request(app)
      .post('/internal/users/activity')
      .send({ discordId: VALID_DISCORD_ID });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ stamped: false });
  });

  it('rejects a non-snowflake discordId with Zod validation', async () => {
    const response = await request(app)
      .post('/internal/users/activity')
      .send({ discordId: 'not-a-snowflake' });

    expect(response.status).toBe(400);
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('rejects a missing discordId', async () => {
    const response = await request(app).post('/internal/users/activity').send({});

    expect(response.status).toBe(400);
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
  });
});
