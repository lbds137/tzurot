/**
 * Component test: the atomic prune's WHERE against REAL Postgres JSONB
 * semantics (PGLite). The unit test can only assert the predicate's shape;
 * this proves `Prisma.AnyNull` actually matches BOTH null representations the
 * configOverrides slice can hold — SQL NULL (never set) and JSON null (what
 * the clear paths write via Prisma.JsonNull) — and that any live slice keeps
 * the row.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { Prisma, PrismaClient } from '@tzurot/common-types/services/prisma';
import { createTestPGlite, loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';
import { pruneEmptyPersonalityConfig } from './pruneEmptyPersonalityConfig.js';

const USER_ID = 'aa1e0000-0000-4000-8000-0000000000a1';
const PERSONA_ID = 'aa1e0000-0000-4000-8000-0000000000a2';
// One anchor row per (user, personality) — unique pair constraint — so each
// test row gets its own personality.
const PERSONALITY_IDS = [
  'aa1e0000-0000-4000-8000-0000000000c1',
  'aa1e0000-0000-4000-8000-0000000000c2',
  'aa1e0000-0000-4000-8000-0000000000c3',
  'aa1e0000-0000-4000-8000-0000000000c4',
] as const;
const DISCORD_ID = '900000000000000081';

const ROW_SQL_NULL = 'aa1e0000-0000-4000-8000-000000000101';
const ROW_JSON_NULL = 'aa1e0000-0000-4000-8000-000000000102';
const ROW_LIVE_OVERRIDES = 'aa1e0000-0000-4000-8000-000000000103';
const ROW_LIVE_PERSONA = 'aa1e0000-0000-4000-8000-000000000104';

describe('pruneEmptyPersonalityConfig (component, PGLite)', () => {
  let pglite: PGlite;
  let prisma: PrismaClient;

  beforeAll(async () => {
    pglite = createTestPGlite();
    await pglite.exec(loadPGliteSchema());
    prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) }) as PrismaClient;

    await seedUserWithPersona(prisma, {
      userId: USER_ID,
      personaId: PERSONA_ID,
      discordId: DISCORD_ID,
      username: 'pruneuser',
      personaName: 'Prune Persona',
      personaContent: 'content',
    });
    for (const [i, personalityId] of PERSONALITY_IDS.entries()) {
      await prisma.personality.create({
        data: {
          id: personalityId,
          name: `Prune Personality ${i + 1}`,
          slug: `prune-personality-${i + 1}`,
          ownerId: USER_ID,
          characterInfo: '',
          personalityTraits: '',
        },
      });
    }

    // Never-set slice: configOverrides is SQL NULL.
    await prisma.userPersonalityConfig.create({
      data: { id: ROW_SQL_NULL, userId: USER_ID, personalityId: PERSONALITY_IDS[0] },
    });
    // Cleared slice: configOverrides is JSON null — exactly what the clear
    // paths write (Prisma.JsonNull). This is the case a plain `null` filter
    // would MISS; AnyNull must match it.
    await prisma.userPersonalityConfig.create({
      data: {
        id: ROW_JSON_NULL,
        userId: USER_ID,
        personalityId: PERSONALITY_IDS[1],
        configOverrides: Prisma.JsonNull,
      },
    });
    // Live JSONB slice: must survive the prune.
    await prisma.userPersonalityConfig.create({
      data: {
        id: ROW_LIVE_OVERRIDES,
        userId: USER_ID,
        personalityId: PERSONALITY_IDS[2],
        configOverrides: { maxMessages: 25 },
      },
    });
    // Live scalar slice: must survive the prune.
    await prisma.userPersonalityConfig.create({
      data: {
        id: ROW_LIVE_PERSONA,
        userId: USER_ID,
        personalityId: PERSONALITY_IDS[3],
        personaId: PERSONA_ID,
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
  });

  it('deletes a row whose configOverrides is SQL NULL (never set)', async () => {
    const pruned = await pruneEmptyPersonalityConfig(prisma, ROW_SQL_NULL);

    expect(pruned).toBe(true);
    const row = await prisma.userPersonalityConfig.findUnique({ where: { id: ROW_SQL_NULL } });
    expect(row).toBeNull();
  });

  it('deletes a row whose configOverrides is JSON null (cleared via JsonNull)', async () => {
    const pruned = await pruneEmptyPersonalityConfig(prisma, ROW_JSON_NULL);

    expect(pruned).toBe(true);
    const row = await prisma.userPersonalityConfig.findUnique({ where: { id: ROW_JSON_NULL } });
    expect(row).toBeNull();
  });

  it('keeps a row with live configOverrides JSONB', async () => {
    const pruned = await pruneEmptyPersonalityConfig(prisma, ROW_LIVE_OVERRIDES);

    expect(pruned).toBe(false);
    const row = await prisma.userPersonalityConfig.findUnique({
      where: { id: ROW_LIVE_OVERRIDES },
    });
    expect(row).not.toBeNull();
  });

  it('keeps a row with a live scalar slice (personaId set)', async () => {
    const pruned = await pruneEmptyPersonalityConfig(prisma, ROW_LIVE_PERSONA);

    expect(pruned).toBe(false);
    const row = await prisma.userPersonalityConfig.findUnique({
      where: { id: ROW_LIVE_PERSONA },
    });
    expect(row).not.toBeNull();
  });
});
