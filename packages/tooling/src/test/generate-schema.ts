/**
 * Generate PGLite Schema
 *
 * Regenerate PGLite schema SQL from Prisma schema.
 * Run this whenever you change prisma/schema.prisma.
 *
 * Ported from scripts/testing/regenerate-pglite-schema.sh
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

interface GenerateSchemaOptions {
  output?: string;
}

/**
 * Match an ALTER TABLE … ADD CONSTRAINT … CHECK (…) statement.
 *
 * Prisma's `migrate diff --from-empty` is based on schema introspection, which
 * has no representation for CHECK constraints — so any CHECK added via a
 * hand-written migration is silently dropped from the generated SQL. Without
 * this extractor, integration tests against PGLite would permit values prod
 * Postgres rejects (empty persona names, snowflake-shaped names, etc.). We
 * sweep migrations for CHECK statements and append them to the output.
 *
 * The regex is intentionally permissive about whitespace/newlines between
 * tokens (some migrations wrap after `ALTER TABLE`, others are single-line).
 * Case-insensitive to match either SQL convention.
 */
/**
 * Matches an `ALTER TABLE ... ADD CONSTRAINT "<name>" CHECK (...)` statement
 * and captures the constraint name. Because `"[^"]+"` requires at least one
 * character inside the quotes, a successful match guarantees group 1 is a
 * non-empty string — see type narrowing in `extractCheckStatementsFromFile`.
 */
const CHECK_CONSTRAINT_REGEX = /^ALTER\s+TABLE\s+"[^"]+"\s+ADD\s+CONSTRAINT\s+"([^"]+)"\s+CHECK\b/i;

interface ExtractedCheck {
  name: string;
  statement: string;
}

/**
 * Parse one migration.sql file and return its CHECK-constraint statements.
 * Strips both line-comments and block-comments before splitting on `;` —
 * block comments matter because a block-comment body can contain a raw `;`
 * that would split the surrounding statement in half and silently drop the
 * CHECK that followed.
 */
function extractCheckStatementsFromFile(sqlPath: string): ExtractedCheck[] {
  const raw = readFileSync(sqlPath, 'utf-8');
  const uncommented = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
  const results: ExtractedCheck[] = [];

  // Prisma migrations use ; as the unambiguous statement terminator even
  // across line breaks. CHECK expressions can contain nested parens but never
  // a raw ;. Splitting here is safer than a multi-line regex that has to
  // balance parens.
  for (const stmt of uncommented.split(';')) {
    const trimmed = stmt.trim();
    if (trimmed.length === 0) continue;
    const match = CHECK_CONSTRAINT_REGEX.exec(trimmed);
    if (match === null) continue;
    const name = match[1];
    // Unreachable per regex (`"[^"]+"` requires the capture), but TS sees
    // match[1] as string | undefined.
    if (name === undefined) continue;

    results.push({
      name,
      statement: normalizeStatement(trimmed) + ';',
    });
  }
  return results;
}

/**
 * Extract all `ADD CONSTRAINT ... CHECK (...)` statements from every
 * `migration.sql` under `migrationsDir`. When the same constraint name
 * appears in multiple migrations (drop + re-add across two files), the
 * **last** migration's definition wins — this matches Postgres's own
 * semantics: after migration B drops and re-adds `c1`, prod enforces
 * migration B's CHECK expression, not migration A's. First-wins would
 * silently ship migration A's (stale) definition into PGLite while prod
 * runs migration B's, re-introducing the fidelity gap this extractor
 * was built to eliminate.
 */
export function extractCheckConstraints(migrationsDir: string): string[] {
  if (!existsSync(migrationsDir)) {
    return [];
  }

  const migrationFolders = readdirSync(migrationsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();

  // Map.set overwrites existing entries while preserving insertion order.
  // Iterating chronologically means later migrations replace earlier ones
  // by name while the overall emission order stays deterministic.
  const byName = new Map<string, string>();

  for (const folder of migrationFolders) {
    const sqlPath = join(migrationsDir, folder, 'migration.sql');
    if (!existsSync(sqlPath)) continue;

    for (const { name, statement } of extractCheckStatementsFromFile(sqlPath)) {
      byName.set(name, statement);
    }
  }

  return Array.from(byName.values());
}

/** Collapse internal whitespace so each statement ends up on one line. */
function normalizeStatement(stmt: string): string {
  return stmt.replace(/\s+/g, ' ').trim();
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

    // Append CHECK constraints harvested from migration SQL. Prisma's schema-
    // level diff doesn't represent CHECK constraints, so they must be merged
    // in post-hoc or PGLite-backed tests silently accept values Postgres would
    // reject.
    const checkStatements = extractCheckConstraints(migrationsDir);
    const sql =
      checkStatements.length > 0
        ? `${baseSql.trimEnd()}\n\n${CHECK_CONSTRAINT_BANNER}\n${checkStatements.join('\n')}\n`
        : baseSql;

    // Write output
    writeFileSync(outputPath, sql);

    // Count lines
    const lines = sql.split('\n').length;

    console.log(
      chalk.green(
        `Generated ${outputPath} (${lines} lines, ${checkStatements.length} CHECK constraints preserved)`
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
