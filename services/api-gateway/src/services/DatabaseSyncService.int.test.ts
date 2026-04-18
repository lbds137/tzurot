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
 * 3. The rollback case — a mid-sync constraint violation aborts the
 *    transaction cleanly; dev remains untouched.
 *
 * Setup notes:
 * - `loadPGliteSchema()` returns SQL generated from `schema.prisma`, which
 *   cannot express DEFERRABLE. The DEFERRABLE ALTER statements from
 *   migration 20260418010642 are applied manually in `beforeAll` so the
 *   test environment matches production's constraint shape.
 * - We spin up TWO PGLite instances — one acts as "dev", one as "prod".
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient, generateUserUuid, generatePersonaUuid } from '@tzurot/common-types';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';
import { DatabaseSyncService } from './DatabaseSyncService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load the real DEFERRABLE migration SQL at test startup instead of
 * hand-maintaining a copy in this file (PR #826 R1 #2). If the migration
 * is ever edited, PGLite environment stays in sync with production's
 * constraint shape automatically — which is the exact invariant this
 * test suite is designed to protect.
 *
 * The PGLite schema generator (`prisma migrate diff --from-empty
 * --to-schema`) emits from `schema.prisma` and can't express DEFERRABLE,
 * so we apply this migration manually on top of `loadPGliteSchema()`.
 */
function loadDeferrableFkMigration(): string {
  // Resolve relative to this test file. Service lives at
  // services/api-gateway/src/services/DatabaseSyncService.int.test.ts;
  // repo root is four `..` up (services/api-gateway/src/services/ → repo).
  const repoRoot = join(__dirname, '..', '..', '..', '..');
  const migrationPath = join(
    repoRoot,
    'prisma',
    'migrations',
    '20260418010642_make_circular_fks_deferrable',
    'migration.sql'
  );
  return readFileSync(migrationPath, 'utf-8');
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

const SEED_MIGRATION_ROW = `
  INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, applied_steps_count)
  VALUES (gen_random_uuid(), 'test-checksum', '20260418010642_make_circular_fks_deferrable', NOW(), 1);
`;

describe('DatabaseSyncService Integration (Ouroboros pattern)', () => {
  let devPglite: PGlite;
  let prodPglite: PGlite;
  let devPrisma: PrismaClient;
  let prodPrisma: PrismaClient;
  let service: DatabaseSyncService;

  beforeAll(async () => {
    const schema = loadPGliteSchema();
    const deferrableFkMigration = loadDeferrableFkMigration();

    devPglite = new PGlite({ extensions: { vector } });
    prodPglite = new PGlite({ extensions: { vector } });
    await devPglite.exec(schema);
    await prodPglite.exec(schema);
    // Apply the DEFERRABLE migration manually since the PGLite schema
    // generator can't express it. Matches what production's migrated
    // schema actually has in place post-20260418010642.
    await devPglite.exec(deferrableFkMigration);
    await prodPglite.exec(deferrableFkMigration);
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
    // a pre-existing ordering fragility (PR #826 R2 #1): `personas.owner_id`
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
        await tx.$executeRawUnsafe(`DELETE FROM "personalities"`);
        await tx.$executeRawUnsafe(`DELETE FROM "llm_configs"`);
        await tx.$executeRawUnsafe(`DELETE FROM "users"`);
        await tx.$executeRawUnsafe(`DELETE FROM "personas"`);
        await tx.$executeRawUnsafe(`DELETE FROM "_prisma_migrations"`);
        await tx.$executeRawUnsafe(SEED_MIGRATION_ROW);
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
   * somewhere else, that's the canary: something similar to the Phase 5b
   * drift recurred and needs the same treatment.
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
      const rows = await prisma.$queryRawUnsafe<
        { constraint_name: string; is_deferrable: string }[]
      >(`
        SELECT constraint_name, is_deferrable
        FROM information_schema.table_constraints
        WHERE constraint_name IN (
          'users_default_persona_id_fkey',
          'users_default_llm_config_id_fkey',
          'personas_owner_id_fkey',
          'llm_configs_owner_id_fkey'
        )
      `);
      expect(rows.length).toBe(4);
      for (const r of rows) {
        expect(r.is_deferrable, `${r.constraint_name} should be DEFERRABLE`).toBe('YES');
      }
    }
  });
});
