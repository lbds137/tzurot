/**
 * Integration test: seedUserWithPersona.
 *
 * Exercises the CTE round-trip end-to-end via PGLite. Verifies the full
 * shape contract (defaults, overrides, both FK directions, the
 * `personas_name_not_snowflake` CHECK constraint) rather than asserting on
 * the SQL template — that way a refactor that reshuffles the CTE but
 * preserves semantics keeps the test green.
 *
 * Test-utils has no vitest config of its own; this file is picked up by
 * the root `vitest.int.config.ts` via its `**\/*.int.test.ts` glob, which
 * means it runs alongside every other integration test under `pnpm
 * test:int`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PrismaClient } from '@tzurot/common-types';
import { loadPGliteSchema } from './setup-pglite.js';
import { seedUserWithPersona } from './seed.js';

describe('seedUserWithPersona (integration)', () => {
  let pglite: PGlite;
  let prisma: PrismaClient;

  beforeAll(async () => {
    pglite = new PGlite({ extensions: { vector, citext } });
    await pglite.exec(loadPGliteSchema());
    const adapter = new PrismaPGlite(pglite);
    prisma = new PrismaClient({ adapter }) as PrismaClient;
  }, 30000);

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
  }, 30000);

  it('creates a (user, persona) pair that satisfies both FK directions', async () => {
    const userId = '00000000-0000-0000-0000-0000000000b1';
    const personaId = '00000000-0000-0000-0000-0000000000b2';

    await seedUserWithPersona(prisma, {
      userId,
      personaId,
      discordId: '111111111111111111',
      username: 'alice',
      personaName: 'alice',
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user).not.toBeNull();
    expect(user?.username).toBe('alice');
    expect(user?.defaultPersonaId).toBe(personaId);

    const persona = await prisma.persona.findUnique({ where: { id: personaId } });
    expect(persona).not.toBeNull();
    expect(persona?.ownerId).toBe(userId);
  });

  it('defaults username to discordId and persona name to "User {discordId}"', async () => {
    const userId = '00000000-0000-0000-0000-0000000000b3';
    const personaId = '00000000-0000-0000-0000-0000000000b4';
    const discordId = '222222222222222222';

    await seedUserWithPersona(prisma, { userId, personaId, discordId });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.username).toBe(discordId); // shell-creation placeholder

    const persona = await prisma.persona.findUnique({ where: { id: personaId } });
    // The default persona name satisfies the personas_name_not_snowflake
    // CHECK constraint added in Phase 5 — a bare snowflake would be rejected.
    expect(persona?.name).toBe(`User ${discordId}`);
    expect(persona?.preferredName).toBe(`User ${discordId}`);
    expect(persona?.content).toBe('');
    expect(persona?.description).toBe('Default persona');
  });

  it('honors overrides for preferredName, content, and description', async () => {
    const userId = '00000000-0000-0000-0000-0000000000b5';
    const personaId = '00000000-0000-0000-0000-0000000000b6';

    await seedUserWithPersona(prisma, {
      userId,
      personaId,
      discordId: '333333333333333333',
      username: 'bob',
      personaName: 'Bob',
      personaPreferredName: 'Robert',
      personaContent: 'A custom bio',
      personaDescription: 'Custom description',
    });

    const persona = await prisma.persona.findUnique({ where: { id: personaId } });
    expect(persona?.name).toBe('Bob');
    expect(persona?.preferredName).toBe('Robert');
    expect(persona?.content).toBe('A custom bio');
    expect(persona?.description).toBe('Custom description');
  });

  it('flags superuser when isSuperuser=true', async () => {
    const userId = '00000000-0000-0000-0000-0000000000b7';
    const personaId = '00000000-0000-0000-0000-0000000000b8';

    await seedUserWithPersona(prisma, {
      userId,
      personaId,
      discordId: '444444444444444444',
      username: 'admin',
      personaName: 'admin',
      isSuperuser: true,
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.isSuperuser).toBe(true);
  });
});
