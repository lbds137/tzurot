/**
 * Generate PGLite Schema
 *
 * Regenerate PGLite schema SQL from Prisma schema.
 * Run this whenever you change prisma/schema.prisma.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';

/**
 * Dummy DATABASE_URL - Prisma doesn't actually connect for migrate diff,
 * just needs a valid-looking URL to identify the provider.
 * Using minimal format to avoid secretlint false positives.
 */
const DUMMY_DATABASE_URL = 'postgres://x:x@x/x';

/**
 * Header preceding appended CHECK statements in the generated schema. Spelled
 * out as a constant (rather than inlined into the template literal) so a
 * reader scanning `generateSchema()` sees the intent immediately instead of
 * parsing an escaped-newline blob.
 */
const CHECK_CONSTRAINT_BANNER = [
  '-- CHECK constraints harvested from prisma/migrations/**/migration.sql',
  "-- (Prisma's schema-diff generator has no CHECK-constraint representation,",
  "-- so they're merged back in here at schema-generation time.)",
].join('\n');

/**
 * Header preceding appended partial-UNIQUE-index statements. Mirrors
 * CHECK_CONSTRAINT_BANNER — broken out as a constant so the intent is visible
 * at the call site rather than buried in an escaped-newline template literal.
 */
const PARTIAL_UNIQUE_INDEX_BANNER = [
  '-- Partial-UNIQUE indexes harvested from prisma/migrations/**/migration.sql',
  "-- (Prisma's schema-diff can't represent partial indexes, so they're merged",
  '-- back in here. These enforce per-kind/per-scope uniqueness that PGLite,',
  '-- being real Postgres-in-WASM, applies just like prod.)',
].join('\n');

/**
 * Header preceding appended DEFERRABLE-constraint ALTERs. Same shape as the
 * banners above.
 */
const DEFERRABLE_CONSTRAINT_BANNER = [
  '-- DEFERRABLE-constraint ALTERs harvested from prisma/migrations/**/migration.sql',
  "-- (Prisma can't express DEFERRABLE in schema.prisma, so the hand-written",
  '-- ALTER CONSTRAINT statements are merged back in here. db-sync relies on',
  '-- SET CONSTRAINTS ALL DEFERRED for atomic circular-FK inserts.)',
].join('\n');

/**
 * Header preceding appended plpgsql functions + triggers. Same shape as the
 * banners above.
 */
const TRIGGER_BANNER = [
  '-- plpgsql functions + triggers harvested from prisma/migrations/**/migration.sql',
  "-- (Prisma's migrate diff cannot see functions or triggers at all, so the",
  '-- hand-written ones are merged back in here. sync_tombstone_capture backs',
  "-- db-sync's deletion propagation; the cache-invalidation triggers' pg_notify",
  '-- calls are listener-less no-ops under PGLite.)',
].join('\n');

interface GenerateSchemaOptions {
  output?: string;
}

/**
 * Matches an `ALTER TABLE ... ADD CONSTRAINT "<name>" CHECK (...)` statement
 * and captures the constraint name.
 *
 * Why this extractor exists: Prisma's `migrate diff --from-empty` is
 * introspection-based and has no representation for CHECK constraints — so
 * any CHECK added via a hand-written migration is silently dropped from the
 * generated SQL. Without this harvest, integration tests against PGLite
 * would permit values prod Postgres rejects (empty persona names,
 * snowflake-shaped names, birthday out-of-range, etc.).
 *
 * The regex is intentionally permissive about whitespace/newlines between
 * tokens (some migrations wrap after `ALTER TABLE`, others are single-line).
 * Case-insensitive to match either SQL convention. `"[^"]+"` requires at
 * least one character inside the quotes, so a successful match guarantees
 * the name group is a non-empty string.
 */
const CHECK_CONSTRAINT_REGEX = /^ALTER\s+TABLE\s+"[^"]+"\s+ADD\s+CONSTRAINT\s+"([^"]+)"\s+CHECK\b/i;
// Matches both forms: `DROP CONSTRAINT "c"` and `DROP CONSTRAINT IF EXISTS "c"`.
// Prisma migrate dev doesn't currently emit `IF EXISTS` for CHECK constraints,
// but a hand-written migration may, and the IF-EXISTS form is semantically
// equivalent for our extraction purposes.
const DROP_CONSTRAINT_REGEX =
  /^ALTER\s+TABLE\s+"[^"]+"\s+DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?"([^"]+)"/i;

/**
 * Matches a `CREATE UNIQUE INDEX "<name>" ON ... WHERE ...` statement and
 * captures the index name.
 *
 * Why this extractor exists: same gap as the CHECK harvest above. Prisma's
 * schema model has no way to express a *partial* index (`WHERE <predicate>`),
 * so any partial-unique index added via a hand-written migration is silently
 * dropped from the generated SQL. Without this harvest, component tests
 * against PGLite would permit duplicate rows prod Postgres rejects (e.g. two
 * `is_default = true` configs for the same `kind`).
 *
 * SCOPE IS DELIBERATELY NARROW: the trailing `WHERE` token is required, so
 * this matches ONLY partial indexes — the exact subset Prisma omits. A plain
 * non-partial `CREATE UNIQUE INDEX` (no WHERE) is already emitted by Prisma's
 * diff; re-harvesting it would produce a duplicate-name CREATE and PGLite
 * would throw "index already exists". And `UNIQUE` is required, so a non-
 * unique partial index (`CREATE INDEX ... WHERE`) — which enforces nothing —
 * is not harvested.
 *
 * The `[\s\S]*?` between the table reference and `WHERE` is lazy so it can
 * span the multi-line column list these statements usually wrap across,
 * without swallowing past the first `WHERE`. Case-insensitive to match either
 * SQL convention.
 */
const PARTIAL_UNIQUE_INDEX_REGEX = /^CREATE\s+UNIQUE\s+INDEX\s+"([^"]+)"\s+ON\s[\s\S]*?\bWHERE\b/i;
// Matches both `DROP INDEX "i"` and `DROP INDEX IF EXISTS "i"`. A hand-written
// migration may DROP a partial-unique index it intends to recreate with a
// different predicate (the per-kind rework does exactly this), so the dedup
// loop needs to see the DROP to apply last-wins correctly.
const DROP_INDEX_REGEX = /^DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?"([^"]+)"/i;

/**
 * Matches an `ALTER TABLE ... ALTER CONSTRAINT "<name>" DEFERRABLE ...`
 * statement and captures the constraint name.
 *
 * Why this extractor exists: same gap again. Prisma cannot express
 * DEFERRABLE in schema.prisma, so the circular-FK migrations hand-write
 * `ALTER CONSTRAINT ... DEFERRABLE INITIALLY IMMEDIATE` — and `migrate diff`
 * silently omits them. Without this harvest, PGLite FKs are NOT DEFERRABLE:
 * `SET CONSTRAINTS ALL DEFERRED` becomes a silent no-op and db-sync's atomic
 * circular inserts (users ↔ personas ↔ configs) fail in component tests while
 * working in prod.
 *
 * The name group cannot match a `NOT DEFERRABLE` revert — `NOT` intervenes
 * between the quoted name and `DEFERRABLE`, so the revert form falls through
 * to DEFERRABLE_UNDO_REGEX below.
 */
const DEFERRABLE_CONSTRAINT_REGEX =
  /^ALTER\s+TABLE\s+"[^"]+"\s+ALTER\s+CONSTRAINT\s+"([^"]+)"\s+DEFERRABLE\b/i;
/**
 * Undoes a harvested DEFERRABLE clause. Two forms retire deferrability:
 * an explicit `ALTER CONSTRAINT "c" NOT DEFERRABLE` revert, or dropping the
 * constraint outright (Prisma emits DROP + re-ADD when an FK definition
 * changes, and the re-ADD never carries DEFERRABLE — so post-drop, prod is
 * not deferrable unless a later migration re-alters it, and the harvest
 * must mirror that).
 */
const DEFERRABLE_UNDO_REGEX =
  /^ALTER\s+TABLE\s+"[^"]+"\s+(?:ALTER\s+CONSTRAINT\s+"([^"]+)"\s+NOT\s+DEFERRABLE\b|DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?"([^"]+)")/i;

type ExtractedOp =
  { kind: 'add'; name: string; statement: string } | { kind: 'drop'; name: string };

/** Collapse internal whitespace so each statement ends up on one line. */
function normalizeStatement(stmt: string): string {
  return stmt.replace(/\s+/g, ' ').trim();
}

/** First defined capture group — undo regexes carry the name in one of two groups. */
function capturedName(match: RegExpExecArray): string | undefined {
  return match.slice(1).find(group => group !== undefined);
}

/**
 * Parse one migration.sql file and emit the add/drop operations matched by
 * the given regex pair. Strips both line-comments and block-comments before
 * splitting on `;` — block comments matter because a block-comment body can
 * contain a raw `;` that would split the surrounding statement in half and
 * silently drop the statement that followed.
 *
 * Prisma migrations use `;` as the unambiguous statement terminator even
 * across line breaks. Harvested expressions can contain nested parens but
 * never a raw `;`, so splitting here is safer than a multi-line regex that
 * has to balance parens.
 *
 * Drops are emitted alongside adds so the last-wins dedup in
 * `harvestLastWins` can remove a previously-added statement when a later
 * migration retires it without re-adding (else PGLite would enforce DDL that
 * prod Postgres no longer has, producing confusing test false positives).
 */
function extractOpsFromFile(sqlPath: string, addRegex: RegExp, dropRegex: RegExp): ExtractedOp[] {
  const raw = readFileSync(sqlPath, 'utf-8');
  const uncommented = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
  const results: ExtractedOp[] = [];

  for (const stmt of uncommented.split(';')) {
    const trimmed = stmt.trim();
    if (trimmed.length === 0) continue;

    const addMatch = addRegex.exec(trimmed);
    if (addMatch !== null) {
      const name = capturedName(addMatch);
      // Unreachable per the regexes (`"[^"]+"` requires the capture), but TS
      // sees the group as string | undefined.
      if (name === undefined) continue;
      results.push({
        kind: 'add',
        name,
        statement: normalizeStatement(trimmed) + ';',
      });
      continue;
    }

    const dropMatch = dropRegex.exec(trimmed);
    if (dropMatch !== null) {
      const name = capturedName(dropMatch);
      // Unreachable per the regexes; guard satisfies TS's view of the group.
      if (name === undefined) continue;
      results.push({ kind: 'drop', name });
    }
  }
  return results;
}

/**
 * Extract all statements matching `addRegex` from every `migration.sql`
 * under `migrationsDir`, applying last-wins dedup by captured name. When the
 * same name appears in multiple migrations (drop + re-add across two files,
 * or a same-file drop-then-add pair), the **last** definition wins — this
 * matches Postgres's own semantics: after migration B drops and re-adds a
 * constraint, prod enforces migration B's definition, not migration A's.
 * First-wins would silently ship the stale definition into PGLite while prod
 * runs the latest one, re-introducing the fidelity gap the harvest exists to
 * eliminate. A drop without re-add removes the entry entirely.
 */
function harvestLastWins(migrationsDir: string, addRegex: RegExp, dropRegex: RegExp): string[] {
  if (!existsSync(migrationsDir)) {
    return [];
  }

  const migrationFolders = readdirSync(migrationsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    // Prisma prefixes folders with `YYYYMMDDHHMMSS_`, so lexicographic sort
    // matches chronological sort — essential for the last-wins dedup below.
    .sort();

  // Map.set overwrites existing entries while preserving insertion order.
  // Iterating chronologically means later migrations replace earlier ones
  // by name while the overall emission order stays deterministic.
  const byName = new Map<string, string>();

  for (const folder of migrationFolders) {
    const sqlPath = join(migrationsDir, folder, 'migration.sql');
    if (!existsSync(sqlPath)) continue;

    for (const op of extractOpsFromFile(sqlPath, addRegex, dropRegex)) {
      if (op.kind === 'add') {
        byName.set(op.name, op.statement);
      } else {
        // Drop without subsequent re-add must remove the prior definition.
        // A drop-then-re-add pair (across files or within one) is handled
        // correctly by the natural sequence: this delete fires, then the
        // following add repopulates with the new statement.
        byName.delete(op.name);
      }
    }
  }

  return Array.from(byName.values());
}

/** All `ADD CONSTRAINT ... CHECK (...)` statements, last-wins deduped. */
export function extractCheckConstraints(migrationsDir: string): string[] {
  return harvestLastWins(migrationsDir, CHECK_CONSTRAINT_REGEX, DROP_CONSTRAINT_REGEX);
}

/** All partial `CREATE UNIQUE INDEX ... WHERE ...` statements, last-wins deduped. */
export function extractPartialUniqueIndexes(migrationsDir: string): string[] {
  return harvestLastWins(migrationsDir, PARTIAL_UNIQUE_INDEX_REGEX, DROP_INDEX_REGEX);
}

/** All `ALTER CONSTRAINT ... DEFERRABLE ...` statements, last-wins deduped. */
export function extractDeferrableConstraints(migrationsDir: string): string[] {
  return harvestLastWins(migrationsDir, DEFERRABLE_CONSTRAINT_REGEX, DEFERRABLE_UNDO_REGEX);
}

/**
 * plpgsql function definitions can't go through the `;`-split path — their
 * dollar-quoted bodies contain raw `;`. These regexes run against the WHOLE
 * uncommented file text instead. Trigger statements never contain `;`, so
 * the non-greedy terminator match is safe for them.
 */
// Linear-time by construction (regexp/no-super-linear-backtracking): the
// header segment excludes '$' outright, and the body matcher only lets a
// lone '$' through when it is NOT opening the closing '$$' — no two
// quantifiers can exchange characters.
const CREATE_FUNCTION_REGEX =
  /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)[^$]*\$\$(?:[^$]|\$(?!\$))*\$\$\s+LANGUAGE\s+plpgsql\s*;/gi;
const DROP_FUNCTION_REGEX = /DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)/gi;
const CREATE_TRIGGER_REGEX = /CREATE\s+TRIGGER\s+([A-Za-z_][A-Za-z0-9_]*)\b[^;]*;/gi;
const DROP_TRIGGER_REGEX = /DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)/gi;

/**
 * Whole-file variant of the harvest: collects add/drop matches WITH their
 * file positions so within-file ordering holds — trigger migrations use the
 * idempotent `DROP TRIGGER IF EXISTS x; CREATE TRIGGER x ...` pattern, and a
 * position-blind pass would apply the drop after the add and lose it.
 * Last-wins by name across chronologically-sorted migration files, exactly
 * like `harvestLastWins`.
 */
function harvestWholeFileLastWins(
  migrationsDir: string,
  addRegex: RegExp,
  dropRegex: RegExp
): string[] {
  if (!existsSync(migrationsDir)) {
    return [];
  }
  const migrationFolders = readdirSync(migrationsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();

  const byName = new Map<string, string>();
  for (const folder of migrationFolders) {
    const sqlPath = join(migrationsDir, folder, 'migration.sql');
    if (!existsSync(sqlPath)) continue;
    const raw = readFileSync(sqlPath, 'utf-8');
    const uncommented = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');

    const ops: { index: number; kind: 'add' | 'drop'; name: string; statement?: string }[] = [];
    for (const match of uncommented.matchAll(addRegex)) {
      ops.push({
        index: match.index ?? 0,
        kind: 'add',
        name: match[1],
        statement: match[0].trim(),
      });
    }
    for (const match of uncommented.matchAll(dropRegex)) {
      ops.push({ index: match.index ?? 0, kind: 'drop', name: match[1] });
    }
    ops.sort((a, b) => a.index - b.index);
    for (const op of ops) {
      if (op.kind === 'add' && op.statement !== undefined) {
        byName.set(op.name, op.statement);
      } else {
        byName.delete(op.name);
      }
    }
  }
  return Array.from(byName.values());
}

/** All plpgsql `CREATE FUNCTION` bodies, last-wins deduped by function name. */
export function extractPlpgsqlFunctions(migrationsDir: string): string[] {
  return harvestWholeFileLastWins(migrationsDir, CREATE_FUNCTION_REGEX, DROP_FUNCTION_REGEX);
}

/** All `CREATE TRIGGER` statements, last-wins deduped by trigger name. */
export function extractTriggers(migrationsDir: string): string[] {
  return harvestWholeFileLastWins(migrationsDir, CREATE_TRIGGER_REGEX, DROP_TRIGGER_REGEX);
}

/**
 * Generate PGLite-compatible SQL schema from Prisma
 */
export async function generateSchema(options: GenerateSchemaOptions = {}): Promise<void> {
  const rootDir = process.cwd();
  const outputPath =
    options.output ?? join(rootDir, 'packages', 'test-utils', 'schema', 'pglite-schema.sql');
  const migrationsDir = join(rootDir, 'prisma', 'migrations');

  console.log(chalk.cyan('Generating PGLite schema from Prisma...'));

  try {
    // Set dummy DATABASE_URL if not already set
    const env = {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL ?? DUMMY_DATABASE_URL,
    };

    // Run prisma migrate diff using execFileSync (no shell injection)
    const schemaPath = join(rootDir, 'prisma', 'schema.prisma');
    const baseSql = execFileSync(
      'npx',
      ['prisma', 'migrate', 'diff', '--from-empty', '--to-schema', schemaPath, '--script'],
      {
        encoding: 'utf-8',
        env,
        cwd: rootDir,
        stdio: ['pipe', 'pipe', 'pipe'], // Capture stderr
      }
    );

    // Append the DDL Prisma's schema-level diff can't represent, harvested
    // from the hand-written migration SQL: CHECK constraints, partial-unique
    // indexes, and DEFERRABLE-constraint ALTERs. Without the merge, PGLite-
    // backed tests silently diverge from prod Postgres on each front.
    const checkStatements = extractCheckConstraints(migrationsDir);
    const partialUniqueStatements = extractPartialUniqueIndexes(migrationsDir);
    // Appended AFTER the base diff, which contains every ADD CONSTRAINT the
    // ALTERs reference — so the harvested statements always find their target.
    const deferrableStatements = extractDeferrableConstraints(migrationsDir);
    // Functions BEFORE triggers — triggers reference them.
    const functionStatements = extractPlpgsqlFunctions(migrationsDir);
    const triggerStatements = extractTriggers(migrationsDir);

    const harvestedSections: string[] = [];
    if (checkStatements.length > 0) {
      harvestedSections.push(`${CHECK_CONSTRAINT_BANNER}\n${checkStatements.join('\n')}`);
    }
    if (partialUniqueStatements.length > 0) {
      harvestedSections.push(
        `${PARTIAL_UNIQUE_INDEX_BANNER}\n${partialUniqueStatements.join('\n')}`
      );
    }
    if (deferrableStatements.length > 0) {
      harvestedSections.push(`${DEFERRABLE_CONSTRAINT_BANNER}\n${deferrableStatements.join('\n')}`);
    }
    if (functionStatements.length > 0 || triggerStatements.length > 0) {
      harvestedSections.push(
        `${TRIGGER_BANNER}\n${[...functionStatements, ...triggerStatements].join('\n\n')}`
      );
    }

    // Only reshape the base SQL when there's something to append — otherwise
    // emit Prisma's diff verbatim (preserving its existing trailing-newline
    // shape). Each harvested section is separated by a blank line and the file
    // ends with a single trailing newline.
    const sql =
      harvestedSections.length > 0
        ? `${baseSql.trimEnd()}\n\n${harvestedSections.join('\n\n')}\n`
        : baseSql;

    // Write output
    writeFileSync(outputPath, sql);

    // Count lines
    const lines = sql.split('\n').length;

    console.log(
      chalk.green(
        `Generated ${outputPath} (${lines} lines, ${checkStatements.length} CHECK constraints, ` +
          `${partialUniqueStatements.length} partial-UNIQUE indexes, ` +
          `${deferrableStatements.length} DEFERRABLE constraints preserved)`
      )
    );
    console.log(chalk.dim('Remember to commit the updated schema file.'));
  } catch (error) {
    console.error(chalk.red('Failed to generate schema'));

    if (error instanceof Error) {
      // Check for common issues
      if (error.message.includes('prisma')) {
        console.error(chalk.dim('Make sure Prisma is installed: pnpm install'));
      }
      console.error(chalk.dim(error.message));
    }

    process.exitCode = 1;
  }
}
