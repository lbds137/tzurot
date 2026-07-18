/**
 * Component test: personality-alias tier schema invariants (real PGLite).
 *
 * The uniqueness rules live in two hand-written PARTIAL unique indexes on
 * lower(alias) (Prisma can't represent them, so no unit test can see them —
 * only the real schema enforces them):
 * - global tier: unique among rows WHERE user_id IS NULL
 * - user tier:  unique per (user_id) among rows WHERE user_id IS NOT NULL
 *
 * Verified here: case-insensitive per-tier uniqueness, cross-tier same-name
 * coexistence, per-user independence, and user-delete cascade.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  generateUserUuid,
  generatePersonaUuid,
  generatePersonalityUuid,
  generatePersonalityAliasUuid,
  generateUserPersonalityAliasUuid,
} from '@tzurot/common-types/utils/deterministicUuid';
import type { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import {
  createTestPGlite,
  setupTestEnvironment,
  loadPGliteSchema,
  seedUserWithPersona,
  type TestEnvironment,
} from '@tzurot/test-utils';

describe('personality alias tiers (schema invariants)', () => {
  let testEnv: TestEnvironment;
  let pglite: PGlite;
  let prisma: PrismaClient;

  const USER_A_DISCORD = '11111111111111111111';
  const USER_B_DISCORD = '22222222222222222222';
  const userAId = generateUserUuid(USER_A_DISCORD);
  const userBId = generateUserUuid(USER_B_DISCORD);
  const personalityId = generatePersonalityUuid('alias-tier-target');

  beforeAll(async () => {
    testEnv = await setupTestEnvironment();
    pglite = createTestPGlite();
    await pglite.exec(loadPGliteSchema());
    const adapter = new PrismaPGlite(pglite);
    prisma = new PrismaClient({ adapter }) as PrismaClient;
  }, 30000);

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await prisma.personalityAlias.deleteMany({});
    await prisma.personality.deleteMany({});
    await prisma.user.deleteMany({});

    await seedUserWithPersona(prisma, {
      userId: userAId,
      personaId: generatePersonaUuid('user-a', userAId),
      discordId: USER_A_DISCORD,
      username: 'user-a',
    });
    await seedUserWithPersona(prisma, {
      userId: userBId,
      personaId: generatePersonaUuid('user-b', userBId),
      discordId: USER_B_DISCORD,
      username: 'user-b',
    });
    await prisma.personality.create({
      data: {
        id: personalityId,
        name: 'Alias Tier Target',
        slug: 'alias-tier-target',
        ownerId: userAId,
        characterInfo: '',
        personalityTraits: '',
      },
    });
  });

  it('rejects a case-variant duplicate in the GLOBAL tier (partial unique on lower(alias))', async () => {
    await prisma.personalityAlias.create({
      data: { id: generatePersonalityAliasUuid('Mommy'), alias: 'Mommy', personalityId },
    });

    // Distinct explicit id so the PARTIAL INDEX (not the deterministic PK)
    // is what rejects the case-variant.
    await expect(
      prisma.personalityAlias.create({
        data: { id: '99999999-9999-4999-8999-999999999999', alias: 'mommy', personalityId },
      })
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects a case-variant duplicate within ONE user tier', async () => {
    await prisma.personalityAlias.create({
      data: {
        id: generateUserPersonalityAliasUuid(userAId, 'mommy'),
        alias: 'mommy',
        personalityId,
        userId: userAId,
      },
    });

    await expect(
      prisma.personalityAlias.create({
        data: {
          id: '88888888-8888-4888-8888-888888888888',
          alias: 'MOMMY',
          personalityId,
          userId: userAId,
        },
      })
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows the SAME alias to coexist across tiers and across users', async () => {
    // Global row…
    await prisma.personalityAlias.create({
      data: { id: generatePersonalityAliasUuid('mommy'), alias: 'mommy', personalityId },
    });
    // …plus user A's personal row…
    await prisma.personalityAlias.create({
      data: {
        id: generateUserPersonalityAliasUuid(userAId, 'mommy'),
        alias: 'mommy',
        personalityId,
        userId: userAId,
      },
    });
    // …plus user B's personal row — all three coexist.
    await prisma.personalityAlias.create({
      data: {
        id: generateUserPersonalityAliasUuid(userBId, 'mommy'),
        alias: 'mommy',
        personalityId,
        userId: userBId,
      },
    });

    const rows = await prisma.personalityAlias.findMany({
      where: { alias: 'mommy' },
      take: 10,
    });
    expect(rows).toHaveLength(3);
  });

  it('cascades personal aliases on user delete; global rows survive', async () => {
    await prisma.personalityAlias.create({
      data: { id: generatePersonalityAliasUuid('keeper'), alias: 'keeper', personalityId },
    });
    await prisma.personalityAlias.create({
      data: {
        id: generateUserPersonalityAliasUuid(userBId, 'mine'),
        alias: 'mine',
        personalityId,
        userId: userBId,
      },
    });

    await prisma.user.delete({ where: { id: userBId } });

    const remaining = await prisma.personalityAlias.findMany({ take: 10 });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].alias).toBe('keeper');
    expect(remaining[0].userId).toBeNull();
  });
});
