/**
 * Integration Test: DatabaseSyncService (Ouroboros Pattern)
 *
 * Catches the class-of-bug that beta.100 blocker surfaced: dev↔prod sync
 * across a circular NOT NULL foreign-key pair. The 122-test mock suite in
 * `DatabaseSyncService.test.ts` asserts SQL SHAPE (column order, ON
 * CONFLICT clauses, pass order) but never executes the SQL against a real
 * schema. This file runs the actual sync against PGLite with the real
 * migrated schema, so a future tightening migration that breaks the
 * sync fails here at CI time instead of in prod at `/admin db-sync` time.
 *
 * Specifically tests:
 * 1. The Ouroboros case — prod has a user+persona with circular FKs,
 *    dev is empty; sync must insert both rows to dev with FKs intact
 *    (not NULL). This is the exact failure shape of 23502 on
 *    users.default_persona_id when the migration 20260416215546 made
 *    that column NOT NULL.
 * 2. The conflict resolution case — both sides have data, last-write-wins
 *    still picks the right winner without losing the circular FK values.
 * 3. The DEFERRABLE precondition check — confirms the circular FKs plus
 *    the TTS and vision default FKs on both test DBs are in fact
 *    deferrable, so the Ouroboros pattern has something to defer. If a
 *    migration is ever reverted without updating this suite, this test
 *    fails first and the author knows before the pattern silently degrades.
 * 4. The rollback case — a mid-flush throw aborts the transaction
 *    cleanly; dev remains untouched. Load-bearing for the Ouroboros
 *    pattern since deferred FKs only validate at COMMIT.
 *
 * Setup notes:
 * - `loadPGliteSchema()` carries the DEFERRABLE ALTER statements directly:
 *   the schema generator harvests `ALTER CONSTRAINT ... DEFERRABLE` from the
 *   hand-written migrations (Prisma can't express DEFERRABLE in
 *   schema.prisma), so the test environment matches production's constraint
 *   shape with no manual migration replay here. If a future migration drops
 *   deferrability, the harvest mirrors that and this suite's atomic
 *   circular-insert tests go red.
 * - We spin up TWO PGLite instances — one acts as "dev", one as "prod".
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  generateUserUuid,
  generatePersonaUuid,
  newTtsConfigId,
} from '@tzurot/common-types/utils/deterministicUuid';
import * as syncUpsertBuilder from './sync/SyncUpsertBuilder.js';
import type { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { createTestPGlite, loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';
import { DatabaseSyncService } from './DatabaseSyncService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Repo-root-relative path to `prisma/migrations/`. */
function migrationsDir(): string {
  // Resolve relative to this test file. Service lives at
  // services/api-gateway/src/services/DatabaseSyncService.component.test.ts;
  // repo root is four `..` up (services/api-gateway/src/services/ → repo).
  const repoRoot = join(__dirname, '..', '..', '..', '..');
  return join(repoRoot, 'prisma', 'migrations');
}

/**
 * Load the recovery migration that aligns TTS system-global rows to
 * deterministic UUIDs. Same rationale as the DEFERRABLE migrations: applied
 * manually in `beforeAll` to keep the pglite environment matching production
 * post-20260504140720. Idempotent (WHERE-clauses skip rows already at the
 * target id), so safe to run on a freshly-seeded pglite even though no
 * pre-migration TTS rows exist there.
 */
function loadAlignTtsGlobalsMigration(): string {
  const migrationPath = join(
    migrationsDir(),
    '20260504140720_align_tts_globals_to_deterministic_ids',
    'migration.sql'
  );
  return readFileSync(migrationPath, 'utf-8');
}

/**
 * Return the lexicographically-latest migration directory name (which is
 * also chronologically latest because migrations are prefixed with
 * `YYYYMMDDhhmmss`). Used to seed `_prisma_migrations` so
 * `checkSchemaVersions` sees the *current* schema tip on both DBs —
 * independent of which migration actually landed last. Previously the
 * seed row hardcoded `20260418010642_…`, which would start failing this
 * suite with a schema-version-mismatch error the moment any new
 * migration shipped.
 */
function getLatestMigrationName(): string {
  const entries = readdirSync(migrationsDir());
  const dirs = entries
    .filter(name => {
      if (!/^\d{14}_/.test(name)) {
        return false;
      }
      return statSync(join(migrationsDir(), name)).isDirectory();
    })
    .sort();
  const latest = dirs[dirs.length - 1];
  if (latest === undefined) {
    throw new Error('No migrations found — expected at least one timestamped directory');
  }
  return latest;
}

/**
 * Create Prisma's migration-tracking table and seed one row so
 * `checkSchemaVersions` sees a valid "current migration" on both DBs.
 * Normally Prisma creates this itself via `prisma migrate deploy`, but
 * our PGLite setup uses `migrate diff --from-empty --to-schema` which
 * doesn't include the `_prisma_migrations` table. Schema is copied from
 * Prisma's runtime shape.
 */
const SETUP_PRISMA_MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    id VARCHAR(36) PRIMARY KEY,
    checksum VARCHAR(64) NOT NULL,
    finished_at TIMESTAMPTZ,
    migration_name VARCHAR(255) NOT NULL,
    logs TEXT,
    rolled_back_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    applied_steps_count INT NOT NULL DEFAULT 0
  );
`;

/**
 * Build the seed SQL for `_prisma_migrations` using the current latest
 * migration name. Dynamic so future-added migrations don't break the
 * schema-version check in this suite.
 */
function buildSeedMigrationRow(): string {
  const latest = getLatestMigrationName();
  // Defense-in-depth: the pattern check in getLatestMigrationName() already
  // restricts `latest` to `^\d{14}_…`, but we sanity-check again before
  // string-interpolating into SQL.
  if (!/^[\w-]+$/.test(latest)) {
    throw new Error(`Unexpected characters in migration name: ${latest}`);
  }
  return `
    INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, applied_steps_count)
    VALUES (gen_random_uuid(), 'test-checksum', '${latest}', NOW(), 1);
  `;
}

describe('DatabaseSyncService Integration (Ouroboros pattern)', () => {
  let devPglite: PGlite;
  let prodPglite: PGlite;
  let devPrisma: PrismaClient;
  let prodPrisma: PrismaClient;
  let service: DatabaseSyncService;

  beforeAll(async () => {
    // The schema already carries the DEFERRABLE-constraint ALTERs — the
    // generator harvests them from the hand-written migrations, so no manual
    // migration replay is needed to match production's constraint shape.
    const schema = loadPGliteSchema();
    const alignTtsGlobalsMigration = loadAlignTtsGlobalsMigration();

    devPglite = createTestPGlite();
    prodPglite = createTestPGlite();
    await devPglite.exec(schema);
    await prodPglite.exec(schema);
    // Recovery migration aligning TTS system-global rows to deterministic
    // UUIDs. Idempotent — these pglite instances have no TTS rows yet, so
    // the WHERE clauses match nothing on the first run. Loaded here for
    // parity with production's migration history (and so the
    // _prisma_migrations seed below picks up its name as the latest).
    await devPglite.exec(alignTtsGlobalsMigration);
    await prodPglite.exec(alignTtsGlobalsMigration);
    // Create _prisma_migrations so checkSchemaVersions has a row to find.
    await devPglite.exec(SETUP_PRISMA_MIGRATIONS_TABLE);
    await prodPglite.exec(SETUP_PRISMA_MIGRATIONS_TABLE);

    devPrisma = new PrismaClient({ adapter: new PrismaPGlite(devPglite) }) as PrismaClient;
    prodPrisma = new PrismaClient({ adapter: new PrismaPGlite(prodPglite) }) as PrismaClient;

    service = new DatabaseSyncService(devPrisma, prodPrisma);
  }, 60000);

  afterAll(async () => {
    await devPrisma.$disconnect();
    await prodPrisma.$disconnect();
    await devPglite.close();
    await prodPglite.close();
  });

  beforeEach(async () => {
    // Clean up inside a transaction with SET CONSTRAINTS ALL DEFERRED so
    // the circular FK pair doesn't make us care about table order. This
    // mirrors the Ouroboros pattern of the service under test and removes
    // a pre-existing ordering fragility: `personas.owner_id`
    // ON DELETE CASCADE + `users.default_persona_id` ON DELETE RESTRICT
    // gives Postgres conflicting directives when deleting both sides, and
    // the delete ordering that "works" depends on which row gets cascade-
    // deleted first during the DELETE statement. Wrapping the cleanup in
    // deferred constraints means FK checks fire at COMMIT when everything
    // is already gone — no order dependency.
    for (const prisma of [devPrisma, prodPrisma]) {
      await prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED');
        await tx.$executeRawUnsafe(`DELETE FROM "user_personality_configs"`);
        await tx.$executeRawUnsafe(`DELETE FROM "personality_default_configs"`);
        await tx.$executeRawUnsafe(`DELETE FROM "memory_facts"`);
        await tx.$executeRawUnsafe(`DELETE FROM "personalities"`);
        await tx.$executeRawUnsafe(`DELETE FROM "system_prompts"`);
        await tx.$executeRawUnsafe(`DELETE FROM "llm_configs"`);
        await tx.$executeRawUnsafe(`DELETE FROM "users"`);
        await tx.$executeRawUnsafe(`DELETE FROM "personas"`);
        await tx.$executeRawUnsafe(`DELETE FROM "_prisma_migrations"`);
        await tx.$executeRawUnsafe(buildSeedMigrationRow());
      });
    }
  });

  /**
   * THE CLASS-OF-BUG TEST: this is the exact scenario that reproduces the
   * beta.100 blocker at production's /admin db-sync runtime. Prod has a
   * fully-populated user+persona pair; dev is empty. Pre-Ouroboros, the
   * sync's pass-1 INSERT would fail with Postgres 23502 on
   * users.default_persona_id NOT NULL. Post-Ouroboros, this test passes.
   *
   * If the test starts failing after a future migration tightens an FK
   * somewhere else, that's the canary: something similar to the earlier
   * NOT NULL drift recurred and needs the same treatment.
   */
  it('syncs a user+persona pair with circular FKs from prod to empty dev', async () => {
    const discordId = '12345678901234567890';
    const userId = generateUserUuid(discordId);
    const personaId = generatePersonaUuid('test-user', userId);

    await seedUserWithPersona(prodPrisma, {
      userId,
      personaId,
      discordId,
      username: 'test-user',
      personaName: 'test-user',
    });

    // Sanity: dev is empty before sync
    const devUsersBefore = await devPrisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::bigint as count FROM "users"`
    );
    expect(Number(devUsersBefore[0].count)).toBe(0);

    // This is the call that failed in prod with 23502. Under the Ouroboros
    // refactor + DEFERRABLE FKs, it should complete cleanly.
    await service.sync({ dryRun: false });

    // Dev now has the user row AND the persona row, with the FK
    // populated correctly (NOT NULL, pointing at the real persona).
    const devUser = await devPrisma.user.findUnique({ where: { id: userId } });
    expect(devUser).not.toBeNull();
    expect(devUser?.defaultPersonaId).toBe(personaId);

    const devPersona = await devPrisma.persona.findUnique({ where: { id: personaId } });
    expect(devPersona).not.toBeNull();
    expect(devPersona?.ownerId).toBe(userId);
  }, 30000);

  it('resolves last-write-wins conflicts without losing circular FK values', async () => {
    // Both sides have the same user+persona pair; prod was updated more
    // recently. After sync, dev's row should carry prod's data while
    // still satisfying the circular FK (default_persona_id stays populated).
    const discordId = '98765432109876543210';
    const userId = generateUserUuid(discordId);
    const personaId = generatePersonaUuid('shared-user', userId);

    // Seed both sides with the same pair
    await seedUserWithPersona(devPrisma, {
      userId,
      personaId,
      discordId,
      username: 'old-name',
      personaName: 'shared-user',
    });
    await seedUserWithPersona(prodPrisma, {
      userId,
      personaId,
      discordId,
      username: 'new-name', // prod has the newer value
      personaName: 'shared-user',
    });

    // Touch prod's user.updated_at forward to win the last-write-wins race.
    // seedUserWithPersona sets updated_at=NOW() for both, which could tie;
    // bump prod's explicitly to guarantee winner.
    await prodPrisma.$executeRawUnsafe(
      `UPDATE "users" SET updated_at = NOW() + INTERVAL '1 minute' WHERE id = $1::uuid`,
      userId
    );

    await service.sync({ dryRun: false });

    const devUserAfter = await devPrisma.user.findUnique({ where: { id: userId } });
    expect(devUserAfter?.username).toBe('new-name');
    expect(devUserAfter?.defaultPersonaId).toBe(personaId); // FK not dropped
  }, 30000);

  it('confirms the DEFERRABLE constraints are actually set on both sides', async () => {
    // Precondition guard — if this test fails, the rest of the suite's
    // premise is broken. Don't test the Ouroboros behavior against a DB
    // where the FKs aren't deferrable.
    for (const prisma of [devPrisma, prodPrisma]) {
      // Note the asymmetry: the original (persona, llm_config) Ouroboros
      // migration deferred BOTH directions of each circular pair. The TTS
      // follow-up migration (20260504065151) only deferred the user→ttsConfig
      // direction, NOT tts_configs_owner_id_fkey. That works for sync's
      // current insert order (users before tts_configs) but is a latent
      // gap if the order ever flips. Filed as a follow-up in inbox.md.
      const rows = await prisma.$queryRawUnsafe<
        { constraint_name: string; is_deferrable: string }[]
      >(`
        SELECT constraint_name, is_deferrable
        FROM information_schema.table_constraints
        WHERE constraint_name IN (
          'users_default_persona_id_fkey',
          'users_default_llm_config_id_fkey',
          'users_default_tts_config_id_fkey',
          'users_default_vision_config_id_fkey',
          'personas_owner_id_fkey',
          'llm_configs_owner_id_fkey',
          'memory_facts_superseded_by_id_fkey'
        )
      `);
      expect(rows.length).toBe(7);
      for (const r of rows) {
        expect(r.is_deferrable, `${r.constraint_name} should be DEFERRABLE`).toBe('YES');
      }
    }
  });

  /**
   * Rollback invariant: if anything throws mid-flush, the target DB must
   * be in its pre-sync state — `flushWrites` wraps everything in a single
   * `$transaction`, so Postgres discards all staged INSERTs on an error.
   * This is load-bearing for the Ouroboros pattern: deferred FKs only
   * validate at COMMIT, so an abort before COMMIT means we can't leave
   * orphaned half-inserted rows behind.
   *
   * We spy on `upsertRow` to force a throw after a single write. If
   * `$transaction` doesn't roll back, dev would end up with a partial
   * sync (some rows inserted, some not) — violating the atomicity
   * guarantee the rest of the suite implicitly relies on.
   */
  it('rolls back dev changes when a write throws mid-flush', async () => {
    const discordId = '11111111111111111111';
    const userId = generateUserUuid(discordId);
    const personaId = generatePersonaUuid('rollback-victim', userId);

    await seedUserWithPersona(prodPrisma, {
      userId,
      personaId,
      discordId,
      username: 'rollback-victim',
      personaName: 'rollback-victim',
    });

    // Throw after the first upsert so a partial state would be observable
    // if rollback wasn't working. The spy wraps the real upsertRow so the
    // first call executes against the test DB (leaving a staged row
    // inside the open transaction), then subsequent calls throw.
    const realUpsert = syncUpsertBuilder.upsertRow;
    let callCount = 0;
    const spy = vi.spyOn(syncUpsertBuilder, 'upsertRow').mockImplementation(async opts => {
      callCount += 1;
      if (callCount >= 2) {
        throw new Error('simulated mid-flush failure');
      }
      return realUpsert(opts);
    });

    try {
      await expect(service.sync({ dryRun: false })).rejects.toThrow('simulated mid-flush failure');
    } finally {
      spy.mockRestore();
    }

    // Dev must remain empty — the first staged upsert was inside the
    // transaction that aborted, so the row never became visible.
    const devUser = await devPrisma.user.findUnique({ where: { id: userId } });
    expect(devUser).toBeNull();
    const devPersona = await devPrisma.persona.findUnique({ where: { id: personaId } });
    expect(devPersona).toBeNull();
  }, 30000);

  /**
   * The migration-soak-window regression: a DEFERRABLE migration reaches dev
   * before prod on every release cycle, so the sync must NOT name a
   * constraint the target can't defer (SET CONSTRAINTS throws 42809 and
   * breaks the whole sync — observed in prod the day the memory_facts
   * deferral shipped to dev only). Simulate the window by reverting one
   * side's constraint to NOT DEFERRABLE and assert the sync still completes,
   * deferring only what that side supports.
   */
  it('survives a target whose constraint is not yet deferrable (soak window)', async () => {
    await prodPrisma.$executeRawUnsafe(
      `ALTER TABLE "memory_facts" ALTER CONSTRAINT "memory_facts_superseded_by_id_fkey" NOT DEFERRABLE`
    );
    try {
      const discordId = '88888888888888888888';
      const userId = generateUserUuid(discordId);
      const personaId = generatePersonaUuid('soak-window-user', userId);
      await seedUserWithPersona(devPrisma, {
        userId,
        personaId,
        discordId,
        username: 'soak-window-user',
        personaName: 'soak-window-user',
      });

      // Pre-fix this threw 42809 ("constraint ... is not deferrable") before
      // flushing ANYTHING prod-bound; post-fix the user+persona sync through.
      await service.sync({ dryRun: false });

      const prodUser = await prodPrisma.user.findUnique({ where: { id: userId } });
      expect(prodUser).not.toBeNull();
      expect(prodUser?.defaultPersonaId).toBe(personaId);
    } finally {
      await prodPrisma.$executeRawUnsafe(
        `ALTER TABLE "memory_facts" ALTER CONSTRAINT "memory_facts_superseded_by_id_fkey" DEFERRABLE INITIALLY IMMEDIATE`
      );
    }
  }, 30000);

  /**
   * memory_facts sync: the revive-shaped supersession chain is the
   * adversarial case for the self-FK. After Seattle→Denver→moved-back,
   * the NEWER fact (Denver) carries superseded_by_id → the OLDER fact
   * (Seattle), so no creation-order insert sequence satisfies an immediate
   * FK check. We force the pointer-carrying row FIRST in prod's heap order
   * (fetchAllRows has no ORDER BY → PGLite returns insertion order), so
   * sync upserts it before its target exists on dev. Without the
   * DEFERRABLE self-FK in the SET CONSTRAINTS list this fails with an FK
   * violation at upsert time; with it, Postgres validates the chain at
   * COMMIT. Also proves the vector and array columns survive the roundtrip.
   */
  it('syncs memory_facts with a revive-shaped chain (newer→older pointer, pointer row first)', async () => {
    const discordId = '77777777777777777777';
    const userId = generateUserUuid(discordId);
    const personaId = generatePersonaUuid('fact-sync-user', userId);
    const systemPromptId = '4f9b0f66-aaaa-4000-8000-000000000001';
    const personalityId = '4f9b0f66-aaaa-4000-8000-000000000002';
    const seattleId = '4f9b0f66-aaaa-4000-8000-00000000000a';
    const denverId = '4f9b0f66-aaaa-4000-8000-00000000000b';

    await seedUserWithPersona(prodPrisma, {
      userId,
      personaId,
      discordId,
      username: 'fact-sync-user',
      personaName: 'fact-sync-user',
    });
    await prodPrisma.$executeRawUnsafe(
      `INSERT INTO system_prompts (id, name, content, updated_at)
       VALUES ($1::uuid, 'Fact Sync Prompt', 'prompt', NOW())`,
      systemPromptId
    );
    await prodPrisma.$executeRawUnsafe(
      `INSERT INTO personalities (id, name, display_name, slug, system_prompt_id, character_info, personality_traits, owner_id, updated_at)
       VALUES ($1::uuid, 'FactSyncBot', 'Fact Sync Bot', 'fact-sync-bot', $2::uuid, 'c', 'p', $3::uuid, NOW())`,
      personalityId,
      systemPromptId,
      userId
    );

    // Force the pointer-carrying row FIRST in heap order. MVCC subtlety: an
    // UPDATE appends a new tuple version, so "insert Denver first" is not
    // enough — flipping Denver's pointer moves its tuple to the heap's end.
    // The final touch on Seattle moves ITS tuple last instead, leaving heap
    // order [denver(with pointer), seattle]: sync upserts the pointer before
    // its target exists on dev. (Verified: without the DEFERRABLE self-FK in
    // the SET CONSTRAINTS list, this ordering fails with an FK violation.)
    await prodPrisma.$executeRawUnsafe(
      `INSERT INTO memory_facts (id, personality_id, persona_id, statement, embedding, entity_tags, source_memory_ids, superseded_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'The user lives in Denver', '[0.1,0.2,0.3]'::vector, ARRAY['user','city:denver'], ARRAY['4f9b0f66-aaaa-4000-8000-0000000000f1'], NOW(), NOW())`,
      denverId,
      personalityId,
      personaId
    );
    await prodPrisma.$executeRawUnsafe(
      `INSERT INTO memory_facts (id, personality_id, persona_id, statement, embedding, entity_tags, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'The user lives in Seattle', '[0.4,0.5,0.6]'::vector, ARRAY['user','city:seattle'], NOW())`,
      seattleId,
      personalityId,
      personaId
    );
    await prodPrisma.$executeRawUnsafe(
      `UPDATE memory_facts SET superseded_by_id = $1::uuid WHERE id = $2::uuid`,
      seattleId,
      denverId
    );
    await prodPrisma.$executeRawUnsafe(
      `UPDATE memory_facts SET updated_at = NOW() WHERE id = $1::uuid`,
      seattleId
    );

    await service.sync({ dryRun: false });

    // Both rows landed on dev with the newer→older pointer intact.
    const devFacts = await devPrisma.$queryRawUnsafe<
      {
        id: string;
        statement: string;
        superseded_by_id: string | null;
        superseded_at: Date | null;
        embedding: string | null;
        entity_tags: string[];
        source_memory_ids: string[];
      }[]
    >(
      `SELECT id, statement, superseded_by_id, superseded_at, embedding::text as embedding, entity_tags, source_memory_ids
       FROM memory_facts ORDER BY statement`
    );
    expect(devFacts).toHaveLength(2);
    const [denver, seattle] = devFacts;
    expect(denver.statement).toBe('The user lives in Denver');
    expect(denver.superseded_by_id).toBe(seattleId); // the revive pointer survived
    expect(denver.superseded_at).not.toBeNull();
    expect(denver.embedding).toBe('[0.1,0.2,0.3]'); // vector roundtrip
    expect(denver.entity_tags).toEqual(['user', 'city:denver']);
    expect(denver.source_memory_ids).toEqual(['4f9b0f66-aaaa-4000-8000-0000000000f1']);
    expect(seattle.superseded_by_id).toBeNull(); // active (revived) fact
    expect(seattle.superseded_at).toBeNull();
    expect(seattle.embedding).toBe('[0.4,0.5,0.6]');
  }, 30000);

  /**
   * Parallel to the persona Ouroboros test above, but for the TTS circular
   * FK pair. Validates that the DEFERRABLE migration on
   * users_default_tts_config_id_fkey lets sync land a user with a non-NULL
   * default_tts_config_id alongside the matching tts_configs row in a
   * single transaction. Pre-migration this would fail with FK violation
   * because the user row references a tts_config that hasn't been inserted
   * yet (or vice versa).
   */
  it('syncs a user with default_tts_config_id pointing at a TTS config from prod to empty dev', async () => {
    const discordId = '55555555555555555555';
    const userId = generateUserUuid(discordId);
    const personaId = generatePersonaUuid('tts-default-user', userId);
    const ttsConfigId = newTtsConfigId();

    // Seed user+persona on prod, then attach a tts_config and wire the
    // user's default_tts_config_id at it. The tts_config insert can happen
    // after the user exists (no circular FK needed for THIS write order),
    // but the subsequent UPDATE creates the circular reference that sync
    // must reproduce atomically on dev.
    await seedUserWithPersona(prodPrisma, {
      userId,
      personaId,
      discordId,
      username: 'tts-default-user',
      personaName: 'tts-default-user',
    });
    await prodPrisma.$executeRawUnsafe(
      `
        INSERT INTO tts_configs (id, name, owner_id, provider, updated_at)
        VALUES ($1::uuid, $2, $3::uuid, 'self-hosted', NOW())
      `,
      ttsConfigId,
      'tts-default-config',
      userId
    );
    await prodPrisma.$executeRawUnsafe(
      `UPDATE users SET default_tts_config_id = $1::uuid WHERE id = $2::uuid`,
      ttsConfigId,
      userId
    );

    // Sanity: dev is empty before sync
    const devUsersBefore = await devPrisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::bigint as count FROM "users"`
    );
    expect(Number(devUsersBefore[0].count)).toBe(0);

    await service.sync({ dryRun: false });

    // Dev now has the user, persona, and tts_config rows, with the user's
    // default_tts_config_id correctly pointing at the synced config.
    const devUser = await devPrisma.user.findUnique({ where: { id: userId } });
    expect(devUser).not.toBeNull();
    expect(devUser?.defaultTtsConfigId).toBe(ttsConfigId);

    const devTtsConfig = await devPrisma.ttsConfig.findUnique({ where: { id: ttsConfigId } });
    expect(devTtsConfig).not.toBeNull();
    expect(devTtsConfig?.ownerId).toBe(userId);
    expect(devTtsConfig?.provider).toBe('self-hosted');
  }, 30000);
});
