/**
 * Migration-backfill test for the TTS default-pointer migration.
 *
 * `release:premigrate` runs the backfill against PROD data exactly once —
 * this suite executes the migration's UPDATE statement VERBATIM (read from
 * the migration file, so it can't drift from what actually ships) against
 * PGLite in every prod-plausible starting state. The service-layer component
 * tests cover the pointer READ paths; this covers the one-shot data
 * transformation that seeds them.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { ADMIN_SETTINGS_SINGLETON_ID } from '@tzurot/common-types/schemas/api/adminSettings';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  generatePersonaUuid,
  generateUserUuid,
} from '@tzurot/common-types/utils/deterministicUuid';
import {
  createTestPGlite,
  setupTestEnvironment,
  loadPGliteSchema,
  seedUserWithPersona,
  type TestEnvironment,
} from '@tzurot/test-utils';

const MIGRATION_PATH = fileURLToPath(
  new URL(
    '../../../../prisma/migrations/20260702153648_add_admin_settings_tts_default_pointers/migration.sql',
    import.meta.url
  )
);

/** Extract the backfill UPDATE verbatim from the shipped migration file. */
function loadBackfillSql(): string {
  const sql = readFileSync(MIGRATION_PATH, 'utf-8');
  const match = sql.match(/UPDATE "admin_settings" SET[\s\S]*?;/);
  if (match === null) {
    throw new Error('Backfill UPDATE not found in the migration file — did the migration change?');
  }
  return match[0];
}

describe('TTS default-pointer migration backfill (verbatim SQL)', () => {
  let testEnv: TestEnvironment;
  let pglite: PGlite;
  let prisma: PrismaClient;
  let ownerId: string;
  const backfillSql = loadBackfillSql();

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
    // FK order: configs reference users; users.default_persona_id RESTRICTs
    // persona deletion — so users go before personas.
    await prisma.adminSettings.deleteMany({});
    await prisma.ttsConfig.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.persona.deleteMany({});
    ownerId = generateUserUuid('12345678901234567890');
    await seedUserWithPersona(prisma, {
      userId: ownerId,
      personaId: generatePersonaUuid('owner', ownerId),
      discordId: '12345678901234567890',
      username: 'owner',
      personaName: 'owner',
    });
  });

  function makeConfig(opts: {
    id: string;
    name: string;
    isDefault?: boolean;
    isFreeDefault?: boolean;
    createdAt?: Date;
  }): Promise<unknown> {
    return prisma.ttsConfig.create({
      data: {
        id: opts.id,
        name: opts.name,
        ownerId,
        isGlobal: true,
        isDefault: opts.isDefault ?? false,
        isFreeDefault: opts.isFreeDefault ?? false,
        provider: 'kyutai',
        createdAt: opts.createdAt ?? new Date('2026-01-01T00:00:00Z'),
      },
    });
  }

  async function readPointers(): Promise<{ global: string | null; free: string | null } | null> {
    const row = await prisma.adminSettings.findUnique({
      where: { id: ADMIN_SETTINGS_SINGLETON_ID },
    });
    if (row === null) return null;
    return { global: row.globalDefaultTtsConfigId, free: row.freeDefaultTtsConfigId };
  }

  const A = '11111111-1111-4111-8111-111111111111';
  const B = '22222222-2222-4222-8222-222222222222';
  const C = '33333333-3333-4333-8333-333333333333';

  it('backfills both pointers from distinct flagged rows (expected prod shape)', async () => {
    await prisma.adminSettings.create({ data: { id: ADMIN_SETTINGS_SINGLETON_ID } });
    await makeConfig({ id: A, name: 'system-default', isDefault: true });
    await makeConfig({ id: B, name: 'free-default', isFreeDefault: true });
    await makeConfig({ id: C, name: 'bystander' });

    await prisma.$executeRawUnsafe(backfillSql);

    expect(await readPointers()).toEqual({ global: A, free: B });
  });

  it('points both pointers at one row that holds both flags (fresh-install kyutai shape)', async () => {
    await prisma.adminSettings.create({ data: { id: ADMIN_SETTINGS_SINGLETON_ID } });
    await makeConfig({ id: A, name: 'kyutai-self-hosted', isDefault: true, isFreeDefault: true });

    await prisma.$executeRawUnsafe(backfillSql);

    expect(await readPointers()).toEqual({ global: A, free: A });
  });

  it('picks the OLDEST is_default row deterministically when drift produced duplicates', async () => {
    // Nothing enforces uniqueness on is_default (only is_free_default has the
    // partial-unique index) — the ORDER BY created_at LIMIT 1 must make the
    // pick deterministic rather than storage-order-dependent.
    await prisma.adminSettings.create({ data: { id: ADMIN_SETTINGS_SINGLETON_ID } });
    await makeConfig({
      id: B,
      name: 'newer-default',
      isDefault: true,
      createdAt: new Date('2026-02-01T00:00:00Z'),
    });
    await makeConfig({
      id: A,
      name: 'older-default',
      isDefault: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    await prisma.$executeRawUnsafe(backfillSql);

    expect((await readPointers())?.global).toBe(A);
  });

  it('leaves pointers NULL when no rows carry flags (resolver falls to the hardcoded floor)', async () => {
    await prisma.adminSettings.create({ data: { id: ADMIN_SETTINGS_SINGLETON_ID } });
    await makeConfig({ id: C, name: 'unflagged' });

    await prisma.$executeRawUnsafe(backfillSql);

    expect(await readPointers()).toEqual({ global: null, free: null });
  });

  it('no-ops cleanly when the admin_settings singleton row does not exist (fresh install)', async () => {
    await makeConfig({ id: A, name: 'system-default', isDefault: true });

    await prisma.$executeRawUnsafe(backfillSql);

    expect(await readPointers()).toBeNull();
  });

  it('is idempotent — re-running the backfill after an admin repointed does not corrupt state', async () => {
    // Not a planned scenario (migrations run once), but premigrate reruns
    // after a partial failure are conceivable; the backfill overwrites from
    // flags, so a re-run RESTORES flag-derived state. This pins that known
    // behavior so a future change to the semantics is a conscious one.
    await prisma.adminSettings.create({ data: { id: ADMIN_SETTINGS_SINGLETON_ID } });
    await makeConfig({ id: A, name: 'system-default', isDefault: true });
    await makeConfig({ id: B, name: 'other' });
    await prisma.$executeRawUnsafe(backfillSql);
    await prisma.adminSettings.update({
      where: { id: ADMIN_SETTINGS_SINGLETON_ID },
      data: { globalDefaultTtsConfigId: B },
    });

    await prisma.$executeRawUnsafe(backfillSql);

    expect((await readPointers())?.global).toBe(A);
  });
});
