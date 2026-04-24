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
const CHECK_CONSTRAINT_REGEX = /^ALTER\s+TABLE\s+"[^"]+"\s+ADD\s+CONSTRAINT\s+"[^"]+"\s+CHECK\b/i;

/**
 * Extract all `ADD CONSTRAINT ... CHECK (...)` statements from every
 * `migration.sql` under `migrationsDir`, returned in chronological order
 * (sorted by directory name — Prisma's YYYYMMDDHHMMSS_ prefix sorts correctly).
 * Statements are returned normalized to single-line form, each terminated
 * with a semicolon.
 */
export function extractCheckConstraints(migrationsDir: string): string[] {
  if (!existsSync(migrationsDir)) {
    return [];
  }

  const migrationFolders = readdirSync(migrationsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();

  const checkStatements: string[] = [];

  for (const folder of migrationFolders) {
    const sqlPath = join(migrationsDir, folder, 'migration.sql');
    if (!existsSync(sqlPath)) {
      continue;
    }

    const raw = readFileSync(sqlPath, 'utf-8');
    // Strip single-line -- comments before splitting on ; so a commented-out
    // statement doesn't leak into extraction and the following real statement
    // doesn't get prefixed with comment text.
    const uncommented = raw.replace(/--[^\n]*/g, '');

    // Prisma migrations use ; as the unambiguous statement terminator even
    // across line breaks. CHECK expressions can contain nested parens but never
    // a raw ;. Splitting here is safer than a multi-line regex that has to
    // balance parens.
    for (const stmt of uncommented.split(';')) {
      const trimmed = stmt.trim();
      if (trimmed.length === 0) continue;
      if (CHECK_CONSTRAINT_REGEX.test(trimmed)) {
        checkStatements.push(normalizeStatement(trimmed) + ';');
      }
    }
  }

  return checkStatements;
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
        ? `${baseSql.trimEnd()}\n\n-- CHECK constraints harvested from prisma/migrations/**/migration.sql\n-- (Prisma's schema-diff generator has no CHECK-constraint representation,\n-- so they're merged back in here at schema-generation time.)\n${checkStatements.join('\n')}\n`
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
