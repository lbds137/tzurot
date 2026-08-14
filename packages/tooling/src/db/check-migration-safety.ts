/**
 * Migration Safety Checker
 *
 * Scans migration files for dangerous patterns that could break the database:
 * dropping a protected index without recreating it in the same migration. The
 * protected list is derived from prisma/drift-ignore.json — add entries there,
 * not here.
 *
 * Reached via `.husky/pre-commit` (whenever a migration file is staged), the
 * `pnpm quality` chain, the CI lint job, the weekly `pnpm ops health` roster,
 * and manual `pnpm ops db:check-safety`.
 * See check-migration-safety.WHY.md § "Where it actually runs".
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import chalk from 'chalk';
import { emitSummary } from '../audits/summary.js';
import { PROTECTED_INDEX_ENTRIES } from './protectedIndexRegistry.js';

interface ProtectedIndex {
  name: string;
  dropPattern: RegExp;
  createPattern: RegExp;
  description: string;
}

/**
 * Indexes that must be recreated if dropped. Derived from
 * prisma/drift-ignore.json `protectedIndexes` — the single source of truth
 * shared with inspect-database.ts; protectedIndexRegistries.test.ts enforces
 * the name-set agreement across both. Exported for that guard test only.
 *
 * The registry validates that both patterns compile before handing them over,
 * so the constructions below cannot throw.
 *
 * @internal
 */
export const PROTECTED_INDEXES: ProtectedIndex[] = PROTECTED_INDEX_ENTRIES.map(entry => ({
  name: entry.name,
  description: entry.description,
  dropPattern: new RegExp(entry.dropPattern, 'i'),
  createPattern: new RegExp(entry.createPattern, 'i'),
}));

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
