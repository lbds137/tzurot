/**
 * Migration Status Command
 *
 * Shows the status of database migrations:
 * - Applied migrations (in database)
 * - Pending migrations (in files but not applied)
 * - Failed migrations (started but not finished)
 */

import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { getPrismaClient, disconnectPrisma } from '@tzurot/common-types';
import {
  type Environment,
  validateEnvironment,
  showEnvironmentBanner,
  runPrismaCommand,
} from '../utils/env-runner.js';

interface MigrationRecord {
  id: string;
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  started_at: Date;
  applied_steps_count: number;
}

interface MigrationStatusOptions {
  env?: Environment;
  migrationsPath?: string;
}

/**
 * Get all migration directories from the local filesystem
 */
function getLocalMigrations(migrationsPath: string): string[] {
  if (!fs.existsSync(migrationsPath)) {
    return [];
  }

  return fs
    .readdirSync(migrationsPath, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .filter(dirent => !dirent.name.startsWith('.'))
    .filter(dirent => fs.existsSync(path.join(migrationsPath, dirent.name, 'migration.sql')))
    .map(dirent => dirent.name)
    .sort();
}

/**
 * Show migration status using direct database query (for local env)
 */
async function showStatusDirect(migrationsPath: string): Promise<void> {
  const prisma = getPrismaClient();

  try {
    // Get migrations from database
    const dbMigrations = await prisma.$queryRaw<MigrationRecord[]>`
      SELECT id, migration_name, checksum, finished_at, started_at, applied_steps_count
      FROM _prisma_migrations
      ORDER BY started_at ASC
    `;

    // Get local migration files
    const localMigrations = getLocalMigrations(migrationsPath);

    // Build sets for comparison
    const appliedNames = new Set(dbMigrations.map(m => m.migration_name));
    const failedMigrations = dbMigrations.filter(m => m.finished_at === null);

    // Find pending migrations
    const pendingMigrations = localMigrations.filter(name => !appliedNames.has(name));

    // Display results
    console.log(chalk.bold('\n📊 MIGRATION STATUS'));
    console.log('═'.repeat(60));

    // Applied migrations
    console.log(chalk.green(`\n✅ Applied: ${dbMigrations.length - failedMigrations.length}`));
    if (dbMigrations.length > 0) {
      const recentApplied = dbMigrations
        .filter(m => m.finished_at !== null)
        .slice(-5)
        .reverse();

      for (const m of recentApplied) {
        const date = m.finished_at ? new Date(m.finished_at).toISOString().split('T')[0] : 'N/A';
        console.log(chalk.dim(`   ${date}  ${m.migration_name}`));
      }
      if (dbMigrations.length > 5) {
        console.log(chalk.dim(`   ... and ${dbMigrations.length - 5} more`));
      }
    }

    // Pending migrations
    if (pendingMigrations.length > 0) {
      console.log(chalk.yellow(`\n⏳ Pending: ${pendingMigrations.length}`));
      for (const name of pendingMigrations) {
        console.log(chalk.yellow(`   ${name}`));
      }
    } else {
      console.log(chalk.green('\n⏳ Pending: 0 (database is up to date)'));
    }

    // Failed migrations
    if (failedMigrations.length > 0) {
      console.log(chalk.red(`\n❌ Failed: ${failedMigrations.length}`));
      for (const m of failedMigrations) {
        console.log(chalk.red(`   ${m.migration_name}`));
      }
      console.log(chalk.dim('\n   To resolve failed migrations:'));
      console.log(chalk.cyan('   npx prisma migrate resolve --rolled-back "<name>"'));
      console.log(chalk.cyan('   npx prisma migrate resolve --applied "<name>"'));
    }

    console.log('\n' + '═'.repeat(60));
  } finally {
    await disconnectPrisma();
  }
}

/**
 * Show migration status using Prisma CLI (for Railway environments)
 *
 * Note: Prisma migrate status returns exit code 1 when there are pending
 * or failed migrations, which is informational not an error.
 */
async function showStatusViaPrisma(env: 'dev' | 'prod'): Promise<void> {
  console.log(chalk.dim('\nRunning: npx prisma migrate status\n'));

  const result = await runPrismaCommand(env, 'migrate', ['status']);

  // Exit code 1 from 'migrate status' means pending migrations exist (not an error)
  // Only treat as failure if there was a connection error (indicated by specific output)
  if (result.exitCode !== 0 && result.stderr.includes("Can't reach database server")) {
    console.error(chalk.red('\n❌ Failed to connect to database'));
    process.exit(1);
  }
}

/**
 * Main entry point for migration status command
 */
export async function getMigrationStatus(options: MigrationStatusOptions = {}): Promise<void> {
  const env = options.env ?? 'local';
  const migrationsPath = options.migrationsPath ?? path.join(process.cwd(), 'prisma', 'migrations');

  // Validate environment
  validateEnvironment(env);

  // Show banner
  showEnvironmentBanner(env);

  if (env === 'local') {
    await showStatusDirect(migrationsPath);
  } else {
    await showStatusViaPrisma(env);
  }
}
