/**
 * Migration Safety Checker
 *
 * Scans migration files for dangerous patterns that could break the database:
 * - Dropping protected indexes (idx_memories_embedding) without recreating
 * - Other patterns can be added here
 *
 * This runs in CI and pre-commit to prevent accidental index drops.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import chalk from 'chalk';

interface ProtectedIndex {
  name: string;
  dropPattern: RegExp;
  createPattern: RegExp;
  description: string;
}

// Indexes that must be recreated if dropped
const PROTECTED_INDEXES: ProtectedIndex[] = [
  {
    name: 'idx_memories_embedding',
    dropPattern: /DROP\s+INDEX.*idx_memories_embedding/i,
    createPattern: /CREATE\s+INDEX.*idx_memories_embedding/i,
    description: 'IVFFlat vector index for similarity search',
  },
  {
    name: 'idx_memories_embedding_local',
    dropPattern: /DROP\s+INDEX.*idx_memories_embedding_local/i,
    createPattern: /CREATE\s+INDEX.*idx_memories_embedding_local/i,
    description: 'IVFFlat vector index for local embeddings',
  },
];

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
  const content = readFileSync(filePath, 'utf-8');
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

export interface CheckMigrationSafetyOptions {
  migrationsPath?: string;
  verbose?: boolean;
}

/**
 * Check all migrations for safety issues
 */
export async function checkMigrationSafety(
  options: CheckMigrationSafetyOptions = {}
): Promise<void> {
  const migrationsPath = options.migrationsPath ?? 'prisma/migrations';

  console.log(chalk.cyan('\n🔍 Checking migrations for safety issues...\n'));

  const sqlFiles = findSqlFiles(migrationsPath);

  if (sqlFiles.length === 0) {
    console.log(chalk.yellow('No migration files found.'));
    return;
  }

  if (options.verbose) {
    console.log(chalk.dim(`Found ${sqlFiles.length} migration files\n`));
  }

  const results = sqlFiles.map(checkMigrationFile);
  const violations = results.filter(r => r.violations.length > 0);

  if (violations.length === 0) {
    console.log(chalk.green('✅ All migrations are safe'));
    console.log(chalk.dim(`   Checked ${sqlFiles.length} migration files`));
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
