/**
 * Migration Safety Checker
 *
 * Scans migration files for dangerous patterns that could break the database:
 * dropping a protected index without recreating it in the same migration. The
 * protected list is derived from prisma/drift-ignore.json — add entries there,
 * not here.
 *
 * Reached via the weekly `pnpm ops health` roster and manual
 * `pnpm ops db:check-safety`. It is NOT wired into `pnpm quality`, CI, or
 * `.husky/pre-commit` — the hook hand-rolls its own narrower grep check.
 * See check-migration-safety.WHY.md § "Where it actually runs".
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { emitSummary } from '../audits/summary.js';

interface ProtectedIndex {
  name: string;
  dropPattern: RegExp;
  createPattern: RegExp;
  description: string;
}

/** Raw shape of one `protectedIndexes[]` entry in prisma/drift-ignore.json. */
interface DriftIgnoreProtectedIndexEntry {
  name: string;
  description: string;
  dropPattern: string;
  createPattern: string;
}

/** Minimal shape of drift-ignore.json this loader cares about. */
interface DriftIgnoreFile {
  protectedIndexes: DriftIgnoreProtectedIndexEntry[];
}

/**
 * Default location of prisma/drift-ignore.json, resolved from this module's
 * own file location rather than `process.cwd()`. The two invocation paths run
 * from different working directories — `pnpm ops` from the repo root, vitest
 * from the package directory — so a cwd-relative default would resolve for
 * one and not the other; a module-relative one resolves for both. Pinned by
 * the loader tests, which run under the vitest cwd.
 */
const DEFAULT_DRIFT_IGNORE_PATH = fileURLToPath(
  new URL('../../../../prisma/drift-ignore.json', import.meta.url)
);

/**
 * Load the protected-index registry from prisma/drift-ignore.json's
 * `protectedIndexes` array — the single source of truth for which indexes
 * must never be dropped without a recreate in the same migration.
 *
 * Fails loudly (throws) on a missing file, invalid JSON, or a missing/empty
 * `protectedIndexes` array. This is a safety checker: silently checking zero
 * indexes would look identical to "all migrations are safe," which is
 * precisely the failure this tool exists to prevent.
 *
 * Module-local and parameterless on purpose: the tests reach this through
 * `vi.mock('node:fs')` with memfs seeded at the resolved path, so a path
 * override would be flexibility with no consumer.
 */
function loadProtectedIndexes(): ProtectedIndex[] {
  const driftIgnorePath = DEFAULT_DRIFT_IGNORE_PATH;
  let raw: string;
  try {
    raw = readFileSync(driftIgnorePath, 'utf-8');
  } catch (error) {
    throw new Error(
      `check-migration-safety: could not read drift-ignore.json at ${driftIgnorePath}: ${String(error)}`,
      { cause: error }
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `check-migration-safety: drift-ignore.json at ${driftIgnorePath} is not valid JSON: ${String(error)}`,
      { cause: error }
    );
  }

  // `JSON.parse` accepts bare `null` and every scalar, none of which have a
  // `.protectedIndexes` — reading through them would throw a TypeError naming
  // no file, which is the one failure shape the messages below exist to avoid.
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error(
      `check-migration-safety: drift-ignore.json at ${driftIgnorePath} is not a JSON object`
    );
  }

  const entries = (parsed as Partial<DriftIgnoreFile>).protectedIndexes;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(
      `check-migration-safety: drift-ignore.json at ${driftIgnorePath} has an empty or missing ` +
        `"protectedIndexes" array — refusing to run with zero protected indexes`
    );
  }

  return entries.map((entry, i) => {
    // A null/scalar array element would throw on the first property read below,
    // losing the index number that makes the error actionable.
    if (entry === null || typeof entry !== 'object') {
      throw new Error(
        `check-migration-safety: protectedIndexes[${i}] in ${driftIgnorePath} is not an object`
      );
    }
    if (
      typeof entry.name !== 'string' ||
      typeof entry.description !== 'string' ||
      typeof entry.dropPattern !== 'string' ||
      typeof entry.createPattern !== 'string'
    ) {
      throw new Error(
        `check-migration-safety: protectedIndexes[${i}] in ${driftIgnorePath} is malformed ` +
          `(expected string name/description/dropPattern/createPattern)`
      );
    }
    // An empty pattern compiles fine and matches EVERY file, so neither
    // direction fails safe: an empty dropPattern flags all ~120 migrations as
    // dangerous, and an empty createPattern makes every drop look balanced —
    // silently unprotecting the index. Same class as the empty-array check
    // above, one level down.
    if (entry.dropPattern.length === 0 || entry.createPattern.length === 0) {
      throw new Error(
        `check-migration-safety: protectedIndexes[${i}] ("${entry.name}") in ${driftIgnorePath} ` +
          `has an empty dropPattern or createPattern — an empty pattern matches every file`
      );
    }
    // name and description are both interpolated into the violation message,
    // so an empty one degrades it to "Drops  without recreating ()" — useless
    // at exactly the moment someone is reading it.
    if (entry.name.length === 0 || entry.description.length === 0) {
      throw new Error(
        `check-migration-safety: protectedIndexes[${i}] in ${driftIgnorePath} has an empty ` +
          `name or description — both are reported verbatim when a violation is found`
      );
    }
    // Type-checking the strings above says nothing about whether they compile.
    // An uncatchable SyntaxError here would name neither the file nor the
    // entry, so a typo'd pattern would read as an unrelated crash.
    try {
      return {
        name: entry.name,
        description: entry.description,
        dropPattern: new RegExp(entry.dropPattern, 'i'),
        createPattern: new RegExp(entry.createPattern, 'i'),
      };
    } catch (error) {
      throw new Error(
        `check-migration-safety: protectedIndexes[${i}] ("${entry.name}") in ${driftIgnorePath} ` +
          `has a pattern that is not a valid regular expression: ${String(error)}`,
        { cause: error }
      );
    }
  });
}

/**
 * Indexes that must be recreated if dropped. Derived from
 * prisma/drift-ignore.json `protectedIndexes` — the single source of truth
 * shared with inspect-database.ts; protectedIndexRegistries.test.ts enforces
 * the name-set agreement across both. Exported for that guard test only.
 *
 * @internal
 */
export const PROTECTED_INDEXES: ProtectedIndex[] = loadProtectedIndexes();

interface CheckResult {
  file: string;
  violations: string[];
}

/**
 * Recursively find all .sql files in a directory
 */
function findSqlFiles(dir: string): string[] {
  const files: string[] = [];

  try {
    const entries = readdirSync(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        files.push(...findSqlFiles(fullPath));
      } else if (entry.endsWith('.sql')) {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory doesn't exist or isn't readable
  }

  return files;
}

/**
 * Check a single migration file for dangerous patterns
 */
function checkMigrationFile(filePath: string): CheckResult {
  // Strip SQL line comments before matching: the drift sanitizer leaves
  // "-- REMOVED: DROP INDEX ..." markers in sanitized migrations, and a
  // comment-blind regex flags every one of them as a live drop.
  const content = readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter(line => !line.trimStart().startsWith('--'))
    .join('\n');
  const violations: string[] = [];

  for (const index of PROTECTED_INDEXES) {
    const hasDropIndex = index.dropPattern.test(content);
    const hasCreateIndex = index.createPattern.test(content);

    if (hasDropIndex && !hasCreateIndex) {
      violations.push(`Drops ${index.name} without recreating (${index.description})`);
    }
  }

  return { file: filePath, violations };
}

interface CheckMigrationSafetyOptions {
  migrationsPath?: string;
  verbose?: boolean;
  /** Output only the standardized JSONL audit-summary line (suppresses other stdout). */
  summary?: boolean;
}

/**
 * Pure migration-safety check. No I/O beyond the file reads in `findSqlFiles`;
 * no stdout writes; no `process.exit`. Used by the production CLI entry point
 * (`checkMigrationSafety`) and by canary tests that need to assert deliberate
 * violations are detected. Exported for testing.
 *
 * @internal
 */
export function analyzeMigrationSafety(migrationsPath: string): {
  totalFiles: number;
  violations: CheckResult[];
} {
  const sqlFiles = findSqlFiles(migrationsPath);
  const results = sqlFiles.map(checkMigrationFile);
  const violations = results.filter(r => r.violations.length > 0);
  return { totalFiles: sqlFiles.length, violations };
}

/**
 * Check all migrations for safety issues
 */
export async function checkMigrationSafety(
  options: CheckMigrationSafetyOptions = {}
): Promise<void> {
  const migrationsPath = options.migrationsPath ?? 'prisma/migrations';

  const { totalFiles, violations } = analyzeMigrationSafety(migrationsPath);

  // Summary mode — emit one JSONL line for the audit-aggregator.
  if (options.summary) {
    const findings = violations.reduce((acc, r) => acc + r.violations.length, 0);
    emitSummary({
      tool: 'db:check-safety',
      status: findings > 0 ? 'fail' : 'ok',
      findings,
      baseline: 0,
    });
    if (findings > 0) {
      process.exit(1);
    }
    return;
  }

  console.log(chalk.cyan('\n🔍 Checking migrations for safety issues...\n'));

  if (totalFiles === 0) {
    console.log(chalk.yellow('No migration files found.'));
    return;
  }

  if (options.verbose) {
    console.log(chalk.dim(`Found ${totalFiles} migration files\n`));
  }

  if (violations.length === 0) {
    console.log(chalk.green('✅ All migrations are safe'));
    console.log(chalk.dim(`   Checked ${totalFiles} migration files`));
    return;
  }

  // Report violations
  console.log(chalk.red.bold('⚠️  DANGEROUS MIGRATIONS DETECTED\n'));

  for (const result of violations) {
    const relativePath = relative(process.cwd(), result.file);
    console.log(chalk.red(`❌ ${relativePath}`));
    for (const violation of result.violations) {
      console.log(chalk.yellow(`   → ${violation}`));
    }
    console.log();
  }

  console.log(chalk.dim('─'.repeat(60)));
  console.log(chalk.yellow('\nTo fix: Edit the migration to recreate dropped indexes.'));
  console.log(chalk.dim('See: docs/reference/database/PRISMA_DRIFT_ISSUES.md\n'));

  process.exit(1);
}
