/**
 * Create Safe Migration
 *
 * Wrapper around Prisma migrate that:
 * 1. Prompts for migration name
 * 2. Runs `prisma migrate dev --create-only` (or `migrate diff` fallback for non-TTY)
 * 3. Sanitizes known drift patterns from the generated SQL
 * 4. Reports what was removed
 * 5. Shows the clean migration for review
 *
 * This prevents accidentally dropping protected indexes (like idx_memories_embedding)
 * that Prisma can't represent in its schema.
 *
 * Non-interactive fallback:
 * When stdin is not a TTY (e.g., piped input from AI assistants, CI), Prisma's
 * `migrate dev` refuses to run even with `--create-only --name`. In this case,
 * we fall back to `prisma migrate diff` which generates identical SQL without
 * requiring a TTY, then manually create the migration directory.
 */

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import chalk from 'chalk';
import {
  type Environment,
  validateEnvironment,
  showEnvironmentBanner,
  runPrismaCommand,
  cleanEnvForNpx,
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

interface CreateSafeMigrationOptions {
  env?: Environment;
  name?: string;
  migrationsPath?: string;
}

const MIGRATION_SQL_FILENAME = 'migration.sql';

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
 * Generate a Prisma-compatible timestamp (YYYYMMDDHHMMSS) for migration directory names
 */
export function generateMigrationTimestamp(): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    String(now.getFullYear()) +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  );
}

/**
 * Non-interactive migration creation using `prisma migrate diff`.
 *
 * Fallback for when `prisma migrate dev --create-only` fails due to non-TTY stdin.
 * Generates identical SQL by comparing the migration directory against the schema file,
 * then manually creates the timestamped migration directory.
 *
 * Note: Unlike `migrate dev`, this does NOT validate against a shadow database.
 * The migration will be validated when applied via `prisma migrate dev` or `deploy`.
 */
async function createMigrationViaDiff(
  migrationName: string,
  migrationsPath: string
): Promise<{ migrationDir: string; migrationSql: string } | null> {
  console.log(chalk.yellow('⚡ Using non-interactive fallback (prisma migrate diff)'));
  console.log(chalk.dim('   Shadow DB validation will occur when the migration is applied.\n'));

  // Use --from-config-datasource to read the live database state directly.
  // This avoids the shadow database requirement of --from-migrations.
  // Safe because db:safe-migrate runs locally after all migrations are applied.
  const diffArgs = [
    'prisma',
    'migrate',
    'diff',
    '--from-config-datasource',
    '--to-schema',
    './prisma/schema.prisma',
    '--script',
  ];

  const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>(
    (resolve, reject) => {
      const proc = spawn('npx', diffArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        env: cleanEnvForNpx(),
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
        process.stderr.write(data);
      });

      proc.on('close', code => {
        resolve({ stdout, stderr, exitCode: code ?? 0 });
      });

      proc.on('error', err => {
        console.error(chalk.red('❌ Failed to spawn npx prisma migrate diff'));
        console.error(chalk.dim(`   ${err.message}`));
        reject(err);
      });
    }
  );

  if (result.exitCode !== 0) {
    console.error(chalk.red('\n❌ prisma migrate diff failed'));
    process.exit(1);
  }

  const sql = result.stdout.trim();

  // Check for empty migration (no schema changes)
  if (sql === '' || sql === '-- This is an empty migration.') {
    return null;
  }

  // Create timestamped migration directory
  const timestamp = generateMigrationTimestamp();
  const dirName = `${timestamp}_${migrationName}`;
  const migrationDir = join(migrationsPath, dirName);

  mkdirSync(migrationDir, { recursive: true });
  writeFileSync(join(migrationDir, MIGRATION_SQL_FILENAME), sql + '\n');

  return { migrationDir, migrationSql: sql + '\n' };
}

/** Sentinel substring Prisma emits when stdin is not a TTY (tested with Prisma 6.x) */
const NON_INTERACTIVE_ERROR = 'the environment is non-interactive';

/**
 * Get and validate migration name from options or interactive prompt
 */
async function resolveMigrationName(name: string | undefined): Promise<string> {
  if (name) {
    validateMigrationName(name);
    return name;
  }

  if (!process.stdin.isTTY) {
    console.error(chalk.red('❌ Migration name is required in non-interactive mode'));
    console.error(chalk.dim('   Use: pnpm ops db:safe-migrate --name <name>'));
    process.exit(1);
  }

  const prompted = await promptForMigrationName();
  validateMigrationName(prompted);
  return prompted;
}

/**
 * Attempt to create a migration via interactive `prisma migrate dev --create-only`,
 * falling back to `prisma migrate diff` for non-interactive environments.
 *
 * @returns null if no schema changes detected, otherwise the migration dir and SQL
 */
async function createMigrationWithFallback(
  env: Environment,
  migrationName: string,
  migrationsPath: string
): Promise<{ migrationDir: string; migrationSql: string } | null> {
  const result = await runPrismaCommand(env, 'migrate', [
    'dev',
    '--create-only',
    '--name',
    migrationName,
  ]);

  if (result.exitCode !== 0) {
    const combinedOutput = result.stdout + result.stderr;
    if (!combinedOutput.includes(NON_INTERACTIVE_ERROR)) {
      console.error(chalk.red('\n❌ Failed to create migration'));
      process.exit(1);
    }

    return createMigrationViaDiff(migrationName, migrationsPath);
  }

  if (result.stdout.includes('No pending changes')) {
    return null;
  }

  const latestMigration = findLatestMigration(migrationsPath);
  if (!latestMigration) {
    console.error(chalk.red('❌ Could not find created migration'));
    process.exit(1);
  }

  const migrationDir = join(migrationsPath, latestMigration);
  const migrationSqlPath = join(migrationDir, MIGRATION_SQL_FILENAME);

  try {
    const migrationSql = readFileSync(migrationSqlPath, 'utf-8');
    return { migrationDir, migrationSql };
  } catch {
    console.error(chalk.red(`❌ Could not read ${migrationSqlPath}`));
    process.exit(1);
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

  const migrationName = await resolveMigrationName(options.name);

  console.log(chalk.cyan(`\n📝 Creating migration: ${migrationName}\n`));

  const created = await createMigrationWithFallback(env, migrationName, migrationsPath);

  if (created === null) {
    console.log(chalk.yellow('\n⚠️  No schema changes detected'));
    console.log(chalk.dim('   Your schema is already in sync with the database'));
    return;
  }

  const { migrationDir, migrationSql } = created;

  // Load drift patterns and sanitize
  const migrationSqlPath = join(migrationDir, MIGRATION_SQL_FILENAME);
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
  console.log(chalk.dim('   2. Apply locally: pnpm ops db:migrate'));
  console.log(chalk.dim('   3. Regenerate PGLite schema: pnpm ops test:generate-schema'));
  console.log(chalk.dim('   4. Deploy to Railway: pnpm ops db:migrate --env dev'));
}
