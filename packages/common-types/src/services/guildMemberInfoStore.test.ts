import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getGuildMemberInfos,
  isEmptyGuildInfo,
  recordGuildMemberInfos,
} from './guildMemberInfoStore.js';
import type { PrismaClient } from '../generated/prisma/client.js';

interface MockPrisma {
  userGuildInfo: {
    upsert: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
}

function createPrisma(): MockPrisma {
  return {
    userGuildInfo: {
      upsert: vi.fn(op => op),
      findMany: vi.fn().mockResolvedValue([]),
    },
    // The real client executes the array it is handed; mirroring that keeps the
    // upsert arguments observable without pretending a transaction happened.
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  };
}

const asClient = (p: MockPrisma): PrismaClient => p as unknown as PrismaClient;

const GUILD = '123456789012345678';
const USER = 'user-uuid-1';

describe('isEmptyGuildInfo', () => {
  it('treats the shape an unresolvable member produces as empty', () => {
    expect(isEmptyGuildInfo({ roles: [] })).toBe(true);
  });

  it('does NOT treat a real member who holds no roles as empty', () => {
    // The distinction the whole store rests on: `{ roles: [] }` means "we
    // looked and saw nothing", while a role-less member still carries a join
    // date. Collapsing them would let an unobserved turn clobber a good row.
    expect(isEmptyGuildInfo({ roles: [], joinedAt: '2024-01-01T00:00:00.000Z' })).toBe(false);
    expect(isEmptyGuildInfo({ roles: [], displayColor: '#FF00FF' })).toBe(false);
  });
});

describe('recordGuildMemberInfos', () => {
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = createPrisma();
  });

  it('writes each non-empty observation keyed by (user, guild)', async () => {
    await recordGuildMemberInfos(asClient(prisma), GUILD, [
      {
        userId: USER,
        info: {
          roles: ['Admin', 'Member'],
          displayColor: '#FF00FF',
          joinedAt: '2024-03-04T05:06:07.008Z',
        },
      },
    ]);

    expect(prisma.userGuildInfo.upsert).toHaveBeenCalledWith({
      where: { userId_guildId: { userId: USER, guildId: GUILD } },
      create: {
        userId: USER,
        guildId: GUILD,
        roles: ['Admin', 'Member'],
        displayColor: '#FF00FF',
        joinedAt: new Date('2024-03-04T05:06:07.008Z'),
      },
      update: {
        roles: ['Admin', 'Member'],
        displayColor: '#FF00FF',
        joinedAt: new Date('2024-03-04T05:06:07.008Z'),
      },
    });
  });

  it('drops empty observations rather than clobbering a stored row', async () => {
    await recordGuildMemberInfos(asClient(prisma), GUILD, [{ userId: USER, info: { roles: [] } }]);

    expect(prisma.userGuildInfo.upsert).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('writes nothing when there is no guild (a DM)', async () => {
    await recordGuildMemberInfos(asClient(prisma), '', [
      { userId: USER, info: { roles: ['Admin'] } },
    ]);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('fails soft when the database rejects', async () => {
    prisma.$transaction.mockRejectedValue(new Error('connection refused'));

    await expect(
      recordGuildMemberInfos(asClient(prisma), GUILD, [
        { userId: USER, info: { roles: ['Admin'] } },
      ])
    ).resolves.toBeUndefined();
  });
});

describe('getGuildMemberInfos', () => {
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = createPrisma();
  });

  it('returns stored rows in the schema shape, keyed by user id', async () => {
    prisma.userGuildInfo.findMany.mockResolvedValue([
      {
        userId: USER,
        guildId: GUILD,
        roles: ['Admin'],
        displayColor: '#FF00FF',
        joinedAt: new Date('2024-03-04T05:06:07.008Z'),
      },
    ]);

    const result = await getGuildMemberInfos(asClient(prisma), GUILD, [USER]);

    expect(result.get(USER)).toEqual({
      roles: ['Admin'],
      displayColor: '#FF00FF',
      joinedAt: '2024-03-04T05:06:07.008Z',
    });
  });

  it('maps a null column to absent, never to null', async () => {
    // A null reaching the formatter would render as the string "null"; the
    // schema's optional fields are absent-or-present.
    prisma.userGuildInfo.findMany.mockResolvedValue([
      { userId: USER, guildId: GUILD, roles: [], displayColor: null, joinedAt: null },
    ]);

    const result = await getGuildMemberInfos(asClient(prisma), GUILD, [USER]);

    expect(result.get(USER)).toEqual({ roles: [], displayColor: undefined, joinedAt: undefined });
  });

  it('deduplicates ids and bounds the query', async () => {
    await getGuildMemberInfos(asClient(prisma), GUILD, [USER, USER, 'user-2']);

    expect(prisma.userGuildInfo.findMany).toHaveBeenCalledWith({
      where: { guildId: GUILD, userId: { in: [USER, 'user-2'] } },
      take: 2,
    });
  });

  it('skips the query entirely without a guild or ids', async () => {
    expect((await getGuildMemberInfos(asClient(prisma), '', [USER])).size).toBe(0);
    expect((await getGuildMemberInfos(asClient(prisma), GUILD, [])).size).toBe(0);
    expect(prisma.userGuildInfo.findMany).not.toHaveBeenCalled();
  });

  it('fails soft to an empty map when the read throws', async () => {
    prisma.userGuildInfo.findMany.mockRejectedValue(new Error('connection refused'));

    const result = await getGuildMemberInfos(asClient(prisma), GUILD, [USER]);

    expect(result.size).toBe(0);
  });
});
