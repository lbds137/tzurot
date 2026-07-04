/**
 * Integration tests for the TTS-globals deterministic-UUID recovery migration
 * (`20260504140720_align_tts_globals_to_deterministic_ids`).
 *
 * This is the first PK-rewriting migration in the codebase. Tests verify:
 *   1. UPDATE id propagates via ON UPDATE CASCADE to referring FKs
 *   2. Idempotent — re-running the migration is a no-op
 *   3. Cross-env alignment — dev and prod converge on the same IDs after both
 *      have applied the migration, even though each started with random UUIDs
 *   4. The literal UUIDs in the migration SQL match `generateSystemGlobalTtsConfigUuid`
 *
 * Establishes the test pattern for any future "fix already-deployed-data IDs
 * in-place" migration.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  generateSystemGlobalTtsConfigUuid,
  generateUserPersonalityConfigUuid,
  newTtsConfigId,
} from '@tzurot/common-types/utils/deterministicUuid';
import type { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { createTestPGlite, loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';

const __dirname = dirname(fileURLToPath(import.meta.url));

function migrationsDir(): string {
  // services/api-gateway/src/services/sync/utils/ → repo root is 6x ..
  return join(__dirname, '..', '..', '..', '..', '..', '..', 'prisma', 'migrations');
}

function loadAlignTtsGlobalsMigration(): string {
  return readFileSync(
    join(migrationsDir(), '20260504140720_align_tts_globals_to_deterministic_ids', 'migration.sql'),
    'utf-8'
  );
}

const SUPERUSER_ID = '00000000-0000-0000-0000-0000000000a1';
const SUPERUSER_PERSONA_ID = '00000000-0000-0000-0000-0000000000a2';

const ALIGNED_KYUTAI_ID = '50411d3c-cc98-5f39-839e-abd4fb84b0c8';
const ALIGNED_ELEVENLABS_ID = '845d224f-ad28-5ce1-8b27-f5588d3ae2d1';
const ALIGNED_MISTRAL_ID = '8aa02cad-2c39-5b5b-9d37-482aacb7788d';

async function setupPglite(): Promise<PGlite> {
  const pglite = createTestPGlite();
  // The schema already carries the DEFERRABLE-constraint ALTERs — the
  // generator harvests them from the hand-written migrations.
  await pglite.exec(loadPGliteSchema());
  return pglite;
}

/** Insert the superuser (with persona), then 3 TTS system-globals with the supplied IDs. */
async function seedSuperuserAndTtsGlobals(
  prisma: PrismaClient,
  ids: { kyutai: string; elevenlabs: string; mistral: string }
): Promise<void> {
  await seedUserWithPersona(prisma, {
    userId: SUPERUSER_ID,
    personaId: SUPERUSER_PERSONA_ID,
    discordId: '111111111111111111',
    username: 'admin',
    isSuperuser: true,
  });
  const seeds = [
    {
      id: ids.kyutai,
      name: 'kyutai-self-hosted',
      provider: 'self-hosted',
      modelId: null,
      isDefault: true,
      isFreeDefault: true,
    },
    {
      id: ids.elevenlabs,
      name: 'elevenlabs-multilingual-v2',
      provider: 'elevenlabs',
      modelId: 'eleven_multilingual_v2',
      isDefault: false,
      isFreeDefault: false,
    },
    {
      id: ids.mistral,
      name: 'mistral-voxtral-mini',
      provider: 'mistral',
      modelId: 'voxtral-mini-tts-2603',
      isDefault: false,
      isFreeDefault: false,
    },
  ];
  for (const seed of seeds) {
    await prisma.ttsConfig.create({
      data: {
        id: seed.id,
        name: seed.name,
        ownerId: SUPERUSER_ID,
        isGlobal: true,
        isDefault: seed.isDefault,
        isFreeDefault: seed.isFreeDefault,
        provider: seed.provider,
        modelId: seed.modelId,
      },
    });
  }
}

describe('Recovery migration: align_tts_globals_to_deterministic_ids', () => {
  let pglite: PGlite;
  let prisma: PrismaClient;

  beforeAll(async () => {
    pglite = await setupPglite();
    prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) }) as PrismaClient;
  }, 60000);

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
  });

  beforeEach(async () => {
    // Clean state per test. TRUNCATE ... CASCADE handles the circular
    // users↔personas FK pair without depending on DEFERRABLE behavior under
    // pglite (which doesn't respect SET CONSTRAINTS DEFERRED reliably across
    // separate $executeRawUnsafe calls in a single $transaction).
    await prisma.$executeRawUnsafe(
      'TRUNCATE "users", "personas", "personalities", "tts_configs", "user_personality_configs", "personality_default_tts_configs" CASCADE'
    );
  });

  it('updates the 3 system-global rows to their deterministic IDs', async () => {
    await seedSuperuserAndTtsGlobals(prisma, {
      kyutai: newTtsConfigId(),
      elevenlabs: newTtsConfigId(),
      mistral: newTtsConfigId(),
    });

    await pglite.exec(loadAlignTtsGlobalsMigration());

    const rows = await prisma.ttsConfig.findMany({
      where: { isGlobal: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      // Bounded query per `03-database.md` (CRITICAL rule). Test files are
      // ESLint-excluded so this isn't enforced, but keeping the convention
      // here so future authors copying this test pattern get the right
      // defaults for production code.
      take: 10,
    });
    const byName = Object.fromEntries(rows.map(r => [r.name, r.id]));
    expect(byName['kyutai-self-hosted']).toBe(ALIGNED_KYUTAI_ID);
    expect(byName['elevenlabs-multilingual-v2']).toBe(ALIGNED_ELEVENLABS_ID);
    expect(byName['mistral-voxtral-mini']).toBe(ALIGNED_MISTRAL_ID);
  });

  it('cascades the UPDATE to users.default_tts_config_id', async () => {
    const randomKyutaiId = newTtsConfigId();
    await seedSuperuserAndTtsGlobals(prisma, {
      kyutai: randomKyutaiId,
      elevenlabs: newTtsConfigId(),
      mistral: newTtsConfigId(),
    });
    // Set the superuser's `default_tts_config_id` to the random kyutai id —
    // this FK referrer should auto-update when the recovery migration
    // changes the kyutai row's id.
    await prisma.user.update({
      where: { id: SUPERUSER_ID },
      data: { defaultTtsConfigId: randomKyutaiId },
    });

    await pglite.exec(loadAlignTtsGlobalsMigration());

    const user = await prisma.user.findUnique({
      where: { id: SUPERUSER_ID },
      select: { defaultTtsConfigId: true },
    });
    expect(user?.defaultTtsConfigId).toBe(ALIGNED_KYUTAI_ID);
  });

  it('cascades the UPDATE to personality_default_tts_configs.tts_config_id', async () => {
    // Verifies the cascade fires on a NON-users FK referrer too — the
    // migration comment lists three cascade paths (users, personality
    // defaults, user-personality configs) and this proves the mechanism
    // isn't users-table-specific.
    const randomKyutaiId = newTtsConfigId();
    await seedSuperuserAndTtsGlobals(prisma, {
      kyutai: randomKyutaiId,
      elevenlabs: newTtsConfigId(),
      mistral: newTtsConfigId(),
    });
    // Create a personality (system_prompt_id is NULLABLE in schema, so we
    // can skip the system_prompt fixture entirely).
    const personalityId = '00000000-0000-0000-0000-0000000000c1';
    await prisma.personality.create({
      data: {
        id: personalityId,
        name: 'TestPersonality',
        slug: 'test-personality-cascade',
        ownerId: SUPERUSER_ID,
        characterInfo: 'test',
        personalityTraits: 'test',
      },
    });
    // Create the personality_default_tts_configs row pointing at the
    // pre-migration random kyutai ID — this is the FK that should cascade
    // when the recovery migration UPDATE-rewrites kyutai's id.
    await prisma.personalityDefaultTtsConfig.create({
      data: {
        personalityId,
        ttsConfigId: randomKyutaiId,
      },
    });

    await pglite.exec(loadAlignTtsGlobalsMigration());

    const row = await prisma.personalityDefaultTtsConfig.findUnique({
      where: { personalityId },
      select: { ttsConfigId: true },
    });
    expect(row?.ttsConfigId).toBe(ALIGNED_KYUTAI_ID);
  });

  it('cascades the UPDATE to user_personality_configs.tts_config_id', async () => {
    // Verifies the third FK cascade path called out in the migration
    // comment. Same pattern as the personality_default_tts_configs test —
    // seed a row with the random kyutai id, run migration, assert the
    // ON UPDATE CASCADE propagated to the aligned id.
    const randomKyutaiId = newTtsConfigId();
    await seedSuperuserAndTtsGlobals(prisma, {
      kyutai: randomKyutaiId,
      elevenlabs: newTtsConfigId(),
      mistral: newTtsConfigId(),
    });
    const personalityId = '00000000-0000-0000-0000-0000000000c2';
    await prisma.personality.create({
      data: {
        id: personalityId,
        name: 'TestPersonality',
        slug: 'test-personality-upc-cascade',
        ownerId: SUPERUSER_ID,
        characterInfo: 'test',
        personalityTraits: 'test',
      },
    });
    await prisma.userPersonalityConfig.create({
      data: {
        id: generateUserPersonalityConfigUuid(SUPERUSER_ID, personalityId),
        userId: SUPERUSER_ID,
        personalityId,
        ttsConfigId: randomKyutaiId,
      },
    });

    await pglite.exec(loadAlignTtsGlobalsMigration());

    const row = await prisma.userPersonalityConfig.findUnique({
      where: { userId_personalityId: { userId: SUPERUSER_ID, personalityId } },
      select: { ttsConfigId: true },
    });
    expect(row?.ttsConfigId).toBe(ALIGNED_KYUTAI_ID);
  });

  it('is idempotent — re-running the migration is a no-op with no errors', async () => {
    // Seed with already-aligned IDs (the post-first-run state).
    await seedSuperuserAndTtsGlobals(prisma, {
      kyutai: ALIGNED_KYUTAI_ID,
      elevenlabs: ALIGNED_ELEVENLABS_ID,
      mistral: ALIGNED_MISTRAL_ID,
    });

    // Run twice. WHERE clauses skip rows that already match — no UPDATE fires.
    await expect(pglite.exec(loadAlignTtsGlobalsMigration())).resolves.not.toThrow();
    await expect(pglite.exec(loadAlignTtsGlobalsMigration())).resolves.not.toThrow();

    const rows = await prisma.ttsConfig.findMany({
      where: { isGlobal: true },
      select: { id: true, name: true },
      // Bounded query per `03-database.md` (CRITICAL rule). Test files are
      // ESLint-excluded so this isn't enforced, but keeping the convention
      // here so future authors copying this test pattern get the right
      // defaults for production code.
      take: 10,
    });
    expect(rows.find(r => r.name === 'kyutai-self-hosted')?.id).toBe(ALIGNED_KYUTAI_ID);
    expect(rows.find(r => r.name === 'elevenlabs-multilingual-v2')?.id).toBe(ALIGNED_ELEVENLABS_ID);
    expect(rows.find(r => r.name === 'mistral-voxtral-mini')?.id).toBe(ALIGNED_MISTRAL_ID);
  });

  it('matches `generateSystemGlobalTtsConfigUuid` output exactly', async () => {
    // Sanity check that the literals pasted into the migration SQL match
    // what the helper produces. If this fails, either the helper changed
    // (and the migration is now stale) or the migration's literals are a
    // typo. No DB needed.
    expect(generateSystemGlobalTtsConfigUuid('kyutai-self-hosted')).toBe(ALIGNED_KYUTAI_ID);
    expect(generateSystemGlobalTtsConfigUuid('elevenlabs-multilingual-v2')).toBe(
      ALIGNED_ELEVENLABS_ID
    );
    expect(generateSystemGlobalTtsConfigUuid('mistral-voxtral-mini')).toBe(ALIGNED_MISTRAL_ID);
  });
});
