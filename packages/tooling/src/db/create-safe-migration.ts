/**
 * Create Safe Migration
 *
 * Wrapper around Prisma migrate that:
 * 1. Prompts for migration name
 * 2. Runs `prisma migrate dev --create-only`
 * 3. Sanitizes known drift patterns from the generated SQL
 * 4. Reports what was removed
 * 5. Shows the clean migration for review
 *
 * This prevents accidentally dropping protected indexes (like idx_memories_embedding)
 * that Prisma can't represent in its schema.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import chalk from 'chalk';
import {
  type Environment,
  validateEnvironment,
  showEnvironmentBanner,
  runPrismaCommand,
} from '../utils/env-runner.js';

/** Pattern definition from drift-ignore.json */
interface IgnorePattern {
  pattern: string;
  reason: string;
  action: 'remove';
}

/** Drift ignore configuration */
interface DriftIgnoreConfig {
  ignorePatterns: IgnorePattern[];
}

export interface CreateSafeMigrationOptions {
  env?: Environment;
  name?: string;
  migrationsPath?: string;
}

/**
 * Prompt user for migration name
 */
async function promptForMigrationName(): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => {
    rl.question(chalk.cyan('Migration name (e.g., add_user_settings): '), answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Find the most recently created migration directory
 */
function findLatestMigration(migrationsPath: string): string | null {
  try {
    const entries = readdirSync(migrationsPath);

    // Filter to directories that match migration pattern (timestamp_name)
    const migrations = entries
      .filter(entry => {
        const fullPath = join(migrationsPath, entry);
        return statSync(fullPath).isDirectory() && /^\d{14}_/.test(entry);
      })
      .sort()
      .reverse();

    return migrations[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Load drift ignore patterns from config file
 */
function loadDriftIgnorePatterns(projectRoot: string): IgnorePattern[] {
  const configPath = join(projectRoot, 'prisma', 'drift-ignore.json');

  try {
    const content = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content) as DriftIgnoreConfig;
    return config.ignorePatterns ?? [];
  } catch {
    console.warn(chalk.yellow('⚠️  Could not load drift-ignore.json, using defaults'));
    // Fallback to hardcoded patterns if config not found
    return [
      {
        pattern: 'DROP INDEX.*idx_memories_embedding',
        reason: 'IVFFlat vector index cannot be represented in Prisma schema',
        action: 'remove',
      },
      {
        pattern: 'CREATE INDEX.*memories_chunk_group_id_idx(?!.*WHERE)',
        reason: 'Prisma generates non-partial index, but we need the partial version',
        action: 'remove',
      },
      {
        pattern: 'DROP INDEX.*memories_chunk_group_id_idx',
        reason: 'Partial index cannot be represented in Prisma schema',
        action: 'remove',
      },
    ];
  }
}

/**
 * Sanitize migration SQL by removing known drift patterns
 *
 * @returns Object with sanitized SQL and list of removed statements
 */
export function sanitizeMigrationSql(
  sql: string,
  patterns: IgnorePattern[]
): { sanitized: string; removed: { statement: string; reason: string }[] } {
  const removed: { statement: string; reason: string }[] = [];
  let sanitized = sql;

  for (const pattern of patterns) {
    const regex = new RegExp(`^.*${pattern.pattern}.*$`, 'gim');
    const matches = sanitized.match(regex);

    if (matches) {
      for (const match of matches) {
        removed.push({ statement: match.trim(), reason: pattern.reason });
      }
      sanitized = sanitized.replace(regex, '-- REMOVED: $&');
    }
  }

  // Clean up multiple blank lines left by removals
  sanitized = sanitized.replace(/\n{3,}/g, '\n\n');

  return { sanitized, removed };
}

/**
 * Validate migration name format
 * @returns true if valid, exits process if invalid
 */
function validateMigrationName(name: string | undefined): name is string {
  if (!name || name.length === 0) {
    console.error(chalk.red('❌ Migration name is required'));
    process.exit(1);
  }

  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    console.error(chalk.red('❌ Invalid migration name'));
    console.error(chalk.dim('   Use lowercase letters, numbers, and underscores'));
    console.error(chalk.dim('   Must start with a letter'));
    console.error(chalk.dim('   Example: add_user_settings'));
    process.exit(1);
  }

  return true;
}

/**
 * Display sanitized SQL with syntax highlighting
 */
function displayMigrationSql(sql: string): void {
  console.log(chalk.cyan('\n📋 Migration SQL:\n'));
  console.log(chalk.dim('─'.repeat(60)));

  for (const line of sql.split('\n')) {
    if (line.startsWith('-- REMOVED:')) {
      console.log(chalk.red(line));
    } else if (line.startsWith('--')) {
      console.log(chalk.dim(line));
    } else if (line.trim().length === 0) {
      console.log('');
    } else {
      console.log(chalk.white(line));
    }
  }

  console.log(chalk.dim('─'.repeat(60)));
}

/**
 * Report sanitization results and save if needed
 */
function reportSanitizationResults(
  removed: { statement: string; reason: string }[],
  sanitized: string,
  migrationSqlPath: string
): void {
  if (removed.length > 0) {
    console.log(chalk.yellow('\n🧹 Sanitized dangerous patterns:\n'));
    for (const item of removed) {
      console.log(chalk.red(`   ✗ ${item.statement}`));
      console.log(chalk.dim(`     Reason: ${item.reason}`));
    }
    writeFileSync(migrationSqlPath, sanitized);
    console.log(chalk.green('\n✅ Migration sanitized and saved'));
  } else {
    console.log(chalk.green('\n✅ No dangerous patterns found'));
  }
}

/**
 * Create a safe migration with drift pattern sanitization
 */
export async function createSafeMigration(options: CreateSafeMigrationOptions = {}): Promise<void> {
  const env = options.env ?? 'local';
  const migrationsPath = options.migrationsPath ?? 'prisma/migrations';

  validateEnvironment(env);
  showEnvironmentBanner(env);

  // Get and validate migration name
  let migrationName = options.name;
  migrationName ??= await promptForMigrationName();
  validateMigrationName(migrationName);

  console.log(chalk.cyan(`\n📝 Creating migration: ${migrationName}\n`));

  // Run prisma migrate dev --create-only
  const result = await runPrismaCommand(env, 'migrate', [
    'dev',
    '--create-only',
    '--name',
    migrationName,
  ]);

  if (result.exitCode !== 0) {
    console.error(chalk.red('\n❌ Failed to create migration'));
    process.exit(1);
  }

  // Check if migration was actually created (might be "no changes" scenario)
  if (result.stdout.includes('No pending changes')) {
    console.log(chalk.yellow('\n⚠️  No schema changes detected'));
    console.log(chalk.dim('   Your schema is already in sync with the database'));
    return;
  }

  // Find and read the newly created migration
  const latestMigration = findLatestMigration(migrationsPath);
  if (!latestMigration) {
    console.error(chalk.red('❌ Could not find created migration'));
    process.exit(1);
  }

  const migrationDir = join(migrationsPath, latestMigration);
  const migrationSqlPath = join(migrationDir, 'migration.sql');

  let migrationSql: string;
  try {
    migrationSql = readFileSync(migrationSqlPath, 'utf-8');
  } catch {
    console.error(chalk.red(`❌ Could not read ${migrationSqlPath}`));
    process.exit(1);
  }

  // Load drift patterns and sanitize
  const patterns = loadDriftIgnorePatterns(process.cwd());
  const { sanitized, removed } = sanitizeMigrationSql(migrationSql, patterns);

  // Report and save results
  reportSanitizationResults(removed, sanitized, migrationSqlPath);

  // Show migration summary
  console.log(chalk.cyan('\n📄 Migration created:'));
  console.log(chalk.dim(`   ${migrationDir}`));

  displayMigrationSql(sanitized);

  // Next steps
  console.log(chalk.cyan('\n📌 Next steps:'));
  console.log(chalk.dim('   1. Review the migration SQL above'));
  console.log(chalk.dim('   2. Apply with: pnpm ops db:migrate --env dev'));
  console.log(chalk.dim('   3. Regenerate PGLite schema: pnpm ops test:generate-schema'));
}
