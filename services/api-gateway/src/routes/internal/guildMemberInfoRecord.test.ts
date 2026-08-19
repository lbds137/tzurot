/**
 * Tests for POST /internal/guild-member-info
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { handleRecordGuildMemberInfo } from './guildMemberInfoRecord.js';
import { stubRouteResolvers } from '../../test/shared-route-test-utils.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

const GUILD = '123456789012345678';
const DISCORD_USER = '987654321098765432';

describe('POST /api/internal/guild-member-info', () => {
  let mockPrisma: {
    user: { findUnique: ReturnType<typeof vi.fn> };
    userGuildInfo: { upsert: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = {
      user: { findUnique: vi.fn() },
      userGuildInfo: { upsert: vi.fn(op => op) },
      $transaction: vi.fn(async (ops: unknown[]) => ops),
    };
    app = express();
    app.use(express.json());
    app.post(
      '/internal/guild-member-info',
      handleRecordGuildMemberInfo({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      })
    );
  });

  it('stores the membership against the resolved internal user id', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-uuid-1' });

    const response = await request(app)
      .post('/internal/guild-member-info')
      .send({
        guildId: GUILD,
        discordUserId: DISCORD_USER,
        info: { roles: ['Admin'], displayColor: '#FF00FF' },
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ recorded: true });
    // The stored key is the INTERNAL id, never the Discord snowflake the
    // request carried — the table is keyed by the user row.
    expect(mockPrisma.userGuildInfo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_guildId: { userId: 'user-uuid-1', guildId: GUILD } },
      })
    );
  });

  it('writes nothing for a Discord id with no user row', async () => {
    // A role change fires for every member of a guild, nearly all of whom have
    // never used the bot. Provisioning them here would turn someone else's
    // admin housekeeping into user growth.
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .post('/internal/guild-member-info')
      .send({ guildId: GUILD, discordUserId: DISCORD_USER, info: { roles: ['Admin'] } });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ recorded: false });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a malformed snowflake', async () => {
    const response = await request(app)
      .post('/internal/guild-member-info')
      .send({ guildId: 'not-a-snowflake', discordUserId: DISCORD_USER, info: { roles: [] } });

    expect(response.status).toBe(400);
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });
});
