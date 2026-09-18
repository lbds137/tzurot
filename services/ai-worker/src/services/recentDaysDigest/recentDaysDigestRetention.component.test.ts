/**
 * Component test: recent-days digest retention sweep (real SQL).
 *
 * The delete's correlated NOT EXISTS against `conversation_history`, scoped
 * per (persona, personality) pair, is semantics a mock cannot model
 * faithfully.
 */

import type { PGlite } from '@electric-sql/pglite';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import { createTestPGlite, loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sweepStaleRecentDaysDigests } from './recentDaysDigestRetention.js';

const OWNER_ID = '4f9b0f66-3333-4000-8000-00000000000a';
const PERSONA_ID = '4f9b0f66-3333-4000-8000-00000000000b';
const PERSONALITY_X_ID = '4f9b0f66-3333-4000-8000-00000000000c';
const PERSONALITY_Y_ID = '4f9b0f66-3333-4000-8000-00000000000d';

let pglite: PGlite;
let prisma: PrismaClient;

async function seedPersonalities(): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO personalities
      (id, name, slug, character_info, personality_traits, owner_id, updated_at)
    VALUES (${PERSONALITY_X_ID}::uuid, 'Nova', 'nova', 'info', 'traits', ${OWNER_ID}::uuid, NOW())
  `;
  await prisma.$executeRaw`
    INSERT INTO personalities
      (id, name, slug, character_info, personality_traits, owner_id, updated_at)
    VALUES (${PERSONALITY_Y_ID}::uuid, 'Echo', 'echo', 'info', 'traits', ${OWNER_ID}::uuid, NOW())
  `;
}

async function insertDigestRow(
  personalityId: string,
  generatedAtInterval: string | null,
  status = 'done'
): Promise<string> {
  const id = crypto.randomUUID();
  if (generatedAtInterval === null) {
    await prisma.$executeRaw`
      INSERT INTO persona_personality_digests
        (id, persona_id, personality_id, digest_status, digest_text, generated_at, created_at, updated_at)
      VALUES (${id}::uuid, ${PERSONA_ID}::uuid, ${personalityId}::uuid, ${status}, 'a digest', NULL, NOW(), NOW())
    `;
  } else {
    await prisma.$executeRaw`
      INSERT INTO persona_personality_digests
        (id, persona_id, personality_id, digest_status, digest_text, generated_at, created_at, updated_at)
      VALUES (
        ${id}::uuid, ${PERSONA_ID}::uuid, ${personalityId}::uuid, ${status}, 'a digest',
        NOW() + (${generatedAtInterval}::interval), NOW(), NOW()
      )
    `;
  }
  return id;
}

async function insertHistoryRow(personalityId: string, createdAtInterval: string): Promise<void> {
  const id = crypto.randomUUID();
  await prisma.$executeRaw`
    INSERT INTO conversation_history
      (id, channel_id, personality_id, persona_id, role, content, created_at, updated_at)
    VALUES (
      ${id}::uuid, 'chan-1', ${personalityId}::uuid, ${PERSONA_ID}::uuid, 'user', 'hi',
      NOW() + (${createdAtInterval}::interval), NOW()
    )
  `;
}

async function digestExists(id: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM persona_personality_digests WHERE id = ${id}::uuid
  `;
  return rows.length > 0;
}

beforeAll(async () => {
  pglite = createTestPGlite();
  await pglite.exec(loadPGliteSchema());
  prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) });
  await seedUserWithPersona(prisma, {
    userId: OWNER_ID,
    personaId: PERSONA_ID,
    discordId: '300000000000000002',
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  await pglite.close();
});

beforeEach(async () => {
  await prisma.$executeRaw`DELETE FROM persona_personality_digests`;
  await prisma.$executeRaw`DELETE FROM conversation_history`;
  await prisma.$executeRaw`DELETE FROM personalities`;
  await seedPersonalities();
});

describe('sweepStaleRecentDaysDigests', () => {
  it('C1: a 9-day-old row with no conversation_history rows for the pair is deleted', async () => {
    const id = await insertDigestRow(PERSONALITY_X_ID, '-9 days');

    const result = await sweepStaleRecentDaysDigests(prisma);

    expect(result.deletedCount).toBe(1);
    expect(await digestExists(id)).toBe(false);
  });

  it('C2: the same 9-day-old row survives when in-window history exists for the pair', async () => {
    const id = await insertDigestRow(PERSONALITY_X_ID, '-9 days');
    await insertHistoryRow(PERSONALITY_X_ID, '-2 days');

    const result = await sweepStaleRecentDaysDigests(prisma);

    expect(result.deletedCount).toBe(0);
    expect(await digestExists(id)).toBe(true);
  });

  it('C3: a fresh 3-day-old row is never a delete candidate (inside the render window)', async () => {
    const id = await insertDigestRow(PERSONALITY_X_ID, '-3 days');

    const result = await sweepStaleRecentDaysDigests(prisma);

    expect(result.deletedCount).toBe(0);
    expect(await digestExists(id)).toBe(true);
  });

  it('a 7.5-day-old row survives — past the render window but inside the grace day', async () => {
    const id = await insertDigestRow(PERSONALITY_X_ID, '-7 days -12 hours');

    const result = await sweepStaleRecentDaysDigests(prisma);

    expect(result.deletedCount).toBe(0);
    expect(await digestExists(id)).toBe(true);
  });

  it('a row with generated_at IS NULL survives (never generated, never stale)', async () => {
    const id = await insertDigestRow(PERSONALITY_X_ID, null);

    const result = await sweepStaleRecentDaysDigests(prisma);

    expect(result.deletedCount).toBe(0);
    expect(await digestExists(id)).toBe(true);
  });

  it('deletes a 9-day-old row for pair (persona, personality X) even when in-window history exists for (persona, personality Y) — the guard is per-pair', async () => {
    const id = await insertDigestRow(PERSONALITY_X_ID, '-9 days');
    await insertHistoryRow(PERSONALITY_Y_ID, '-2 days');

    const result = await sweepStaleRecentDaysDigests(prisma);

    expect(result.deletedCount).toBe(1);
    expect(await digestExists(id)).toBe(false);
  });

  it('a dead 9-day-old row with no history rows is swept too — the predicate is status-agnostic', async () => {
    const id = await insertDigestRow(PERSONALITY_X_ID, '-9 days', 'dead');

    const result = await sweepStaleRecentDaysDigests(prisma);

    expect(result.deletedCount).toBe(1);
    expect(await digestExists(id)).toBe(false);
  });
});
