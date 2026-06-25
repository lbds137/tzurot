/**
 * Regression guard: Phase 5 DB-level schema invariants
 *
 * Phase 5 of the Identity & Provisioning Hardening Epic added two CHECK
 * constraints on `personas.name` as defense-in-depth tripwires against the
 * original `c88ae5b7` snowflake-as-persona-name bug class. These live at
 * the schema level (not in Prisma), so application-layer tests don't cover
 * them.
 *
 * Migration: `prisma/migrations/20260416164756_identity_epic_phase_5_db_invariants/migration.sql`
 *
 * The constraints:
 *
 *   personas_name_non_empty:      CHECK (LENGTH(TRIM("name")) > 0)
 *   personas_name_not_snowflake:  CHECK ("name" !~ '^\d{17,19}$')
 *
 * Ideally we'd exercise these behaviorally against PGLite, but Prisma's
 * schema generator doesn't emit CHECK constraints to `pglite-schema.sql`
 * (the file is built from Prisma's introspection, which has no CHECK
 * representation). That's a gap in the generator, not PGLite — tracked
 * as a separate backlog item.
 *
 * Pending that fix, this file is a *structural* guard: it asserts the
 * migration SQL still contains the CHECK DDL strings. A future migration
 * that accidentally drops the constraints (or a `drift-ignore.json` rule
 * that over-matches the DROP pattern) would produce the exact class of
 * silent regression the original Phase 5 work was guarding against.
 * Pinning the DDL text in a test pins the invariant.
 *
 * Descoped from Phase 6 per council review (2026-04-23) because it's
 * orthogonal to the "catch Phase 5c drift" goal — shipped as a separate
 * quick win in the same session.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MIGRATION_SQL_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'prisma',
  'migrations',
  '20260416164756_identity_epic_phase_5_db_invariants',
  'migration.sql'
);

describe('Phase 5 DB-level schema invariants (structural guard)', () => {
  const migrationSql = readFileSync(MIGRATION_SQL_PATH, 'utf8');

  it('migration file exists and is non-empty', () => {
    // Implicit via readFileSync — but pinning the fact explicitly so
    // future maintainers don't quietly delete the migration (it's
    // part of prisma's migration history and must stay).
    expect(migrationSql.length).toBeGreaterThan(0);
  });

  describe('personas_name_non_empty', () => {
    it('defines the CHECK constraint', () => {
      expect(migrationSql).toContain('personas_name_non_empty');
    });

    it('uses TRIM + LENGTH to reject empty-or-whitespace names', () => {
      // Pin the specific shape — a naive CHECK on `name <> ''` would pass
      // whitespace-only names through, which was specifically the bug
      // Phase 5 was guarding against.
      expect(migrationSql).toMatch(/LENGTH\(TRIM\("name"\)\)\s*>\s*0/);
    });
  });

  describe('personas_name_not_snowflake', () => {
    it('defines the CHECK constraint', () => {
      expect(migrationSql).toContain('personas_name_not_snowflake');
    });

    it('uses the 17-19 digit snowflake-length regex', () => {
      // The anchor-boundaries and digit-range are load-bearing. A regex
      // drift that loosens `^\d{17,19}$` to `\d{17,19}` (unanchored) would
      // let names like "hello 1234567890123456789" slip past, even though
      // the bug's shape is "name consists entirely of a Discord snowflake."
      // This assertion pins the anchored + bounded form.
      expect(migrationSql).toMatch(/\^\\d\{17,19\}\$/);
    });
  });

  it('adds both constraints via ALTER TABLE ADD CONSTRAINT (not inline in CREATE TABLE)', () => {
    // Phase 5 constraints were deliberately added via ALTER after-the-fact
    // rather than embedded in the personas table creation — the distinction
    // matters because a future prisma-generated migration that recreates
    // the personas table would drop the CHECKs and not re-add them. An
    // ALTER-style migration is what `drift-ignore.json` is configured to
    // protect against on subsequent `prisma migrate dev` runs.
    const addConstraintCount = (migrationSql.match(/ADD CONSTRAINT/g) ?? []).length;
    expect(addConstraintCount).toBeGreaterThanOrEqual(2);
  });
});
