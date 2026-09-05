/**
 * Tests for DELETE /internal/guild-member-info
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { handleRemoveGuildMemberInfo } from './guildMemberInfoRemove.js';
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

describe('DELETE /api/internal/guild-member-info', () => {
  let mockPrisma: {
    user: { findUnique: ReturnType<typeof vi.fn> };
    userGuildInfo: { deleteMany: ReturnType<typeof vi.fn> };
  };
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = {
      user: { findUnique: vi.fn() },
      userGuildInfo: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    app = express();
    app.use(express.json());
    app.delete(
      '/internal/guild-member-info',
      handleRemoveGuildMemberInfo({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      })
    );
  });

  it('deletes the membership keyed by the resolved internal user id', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-uuid-1' });

    const response = await request(app)
      .delete('/internal/guild-member-info')
      .send({ guildId: GUILD, discordUserId: DISCORD_USER });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ deleted: true });
    // The delete key is the INTERNAL id, never the Discord snowflake the
    // request carried — the table is keyed by the user row.
    expect(mockPrisma.userGuildInfo.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-uuid-1', guildId: GUILD },
    });
  });

  it('deletes nothing for a Discord id with no user row', async () => {
    // A departure fires for every member of a guild, nearly all of whom have
    // never used the bot. Provisioning them here would turn someone else's
    // departure into user growth.
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .delete('/internal/guild-member-info')
      .send({ guildId: GUILD, discordUserId: DISCORD_USER });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ deleted: false });
    expect(mockPrisma.userGuildInfo.deleteMany).not.toHaveBeenCalled();
  });

  it('reports deleted: false for a user row with no stored membership', async () => {
    // Pins the schema's claim that deleted: false is an ordinary outcome, not
    // an error — the user exists but never had a row for this guild.
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-uuid-1' });
    mockPrisma.userGuildInfo.deleteMany.mockResolvedValue({ count: 0 });

    const response = await request(app)
      .delete('/internal/guild-member-info')
      .send({ guildId: GUILD, discordUserId: DISCORD_USER });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ deleted: false });
  });

  it('surfaces a database failure as an error, never as deleted: false', async () => {
    // Pins the schema's `deleted` doc comment: "A database failure is NOT
    // this value; it surfaces as a 500." asyncHandler catches the throw and
    // sends a real error response, so it must never collapse to the same
    // 200/{ deleted: false } shape as the ordinary no-such-row outcome.
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-uuid-1' });
    mockPrisma.userGuildInfo.deleteMany.mockRejectedValue(new Error('connection refused'));

    const response = await request(app)
      .delete('/internal/guild-member-info')
      .send({ guildId: GUILD, discordUserId: DISCORD_USER });

    expect(response.status).not.toBe(200);
    expect(response.body).not.toEqual({ deleted: false });
  });

  it('rejects a malformed snowflake', async () => {
    const response = await request(app)
      .delete('/internal/guild-member-info')
      .send({ guildId: 'not-a-snowflake', discordUserId: DISCORD_USER });

    expect(response.status).toBe(400);
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });
});
