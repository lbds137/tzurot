/**
 * Run Migration Command
 *
 * Safely runs database migrations with environment awareness:
 * - Local: Uses `prisma migrate dev` (interactive)
 * - Dev/Prod: Uses `prisma migrate deploy` (non-interactive)
 *
 * Production operations require explicit --force flag or confirmation.
 */

import chalk from 'chalk';
import {
  type Environment,
  validateEnvironment,
  showEnvironmentBanner,
  runPrismaCommand,
  confirmProductionOperation,
} from '../utils/env-runner.js';

export interface RunMigrationOptions {
  env?: Environment;
  force?: boolean;
  dryRun?: boolean;
}

/**
 * Run migrations for local environment
 */
async function runLocalMigration(dryRun: boolean): Promise<void> {
  if (dryRun) {
    console.log(chalk.yellow('\n🔍 Dry run mode - showing what would be applied:\n'));
    const result = await runPrismaCommand('local', 'migrate', ['status']);
    if (result.exitCode !== 0) {
      process.exit(1);
    }
    return;
  }

  console.log(chalk.dim('\nRunning: npx prisma migrate dev\n'));
  console.log(chalk.yellow('This will apply pending migrations and generate Prisma client.\n'));

  const result = await runPrismaCommand('local', 'migrate', ['dev']);

  if (result.exitCode !== 0) {
    console.error(chalk.red('\n❌ Migration failed'));
    process.exit(1);
  }

  console.log(chalk.green('\n✅ Migration completed successfully'));
}

/**
 * Run migrations for Railway environments (dev/prod)
 */
async function runRailwayMigration(env: 'dev' | 'prod', dryRun: boolean): Promise<void> {
  if (dryRun) {
    console.log(chalk.yellow('\n🔍 Dry run mode - showing current status:\n'));
    const result = await runPrismaCommand(env, 'migrate', ['status']);
    if (result.exitCode !== 0) {
      process.exit(1);
    }
    return;
  }

  // For production, show extra warnings
  if (env === 'prod') {
    console.log(chalk.red.bold('\n⚠️  PRODUCTION MIGRATION'));
    console.log(chalk.red('─'.repeat(50)));
    console.log(chalk.yellow('This will apply migrations to the PRODUCTION database.'));
    console.log(chalk.yellow('Ensure you have tested these migrations on dev first.'));
    console.log(chalk.dim('\nRailway provides automatic backups (Pro plan).'));
    console.log(chalk.dim('Check Railway dashboard → PostgreSQL → Backups if needed.\n'));
  }

  console.log(chalk.dim(`\nRunning: npx prisma migrate deploy\n`));

  const result = await runPrismaCommand(env, 'migrate', ['deploy']);

  if (result.exitCode !== 0) {
    console.error(chalk.red('\n❌ Migration failed'));
    console.error(chalk.dim('\nTo rollback, restore from Railway backup:'));
    console.error(chalk.dim('  https://railway.app → Project → PostgreSQL → Backups'));
    process.exit(1);
  }

  console.log(chalk.green('\n✅ Migration deployed successfully'));
}

/**
 * Main entry point for run migration command
 */
export async function runMigration(options: RunMigrationOptions = {}): Promise<void> {
  const env = options.env ?? 'local';
  const force = options.force ?? false;
  const dryRun = options.dryRun ?? false;

  // Validate environment
  validateEnvironment(env);

  // Show banner
  showEnvironmentBanner(env);

  // Production safety check
  if (env === 'prod' && !dryRun && !force) {
    const confirmed = await confirmProductionOperation('run migrations');
    if (!confirmed) {
      console.log(chalk.yellow('\n⛔ Operation cancelled'));
      process.exit(0);
    }
  }

  if (env === 'local') {
    await runLocalMigration(dryRun);
  } else {
    await runRailwayMigration(env, dryRun);
  }
}

/**
 * Deploy migrations (non-interactive, for CI/scripts)
 *
 * This is a wrapper around runMigration with --force for production.
 */
export async function deployMigration(options: { env?: Environment } = {}): Promise<void> {
  const env = options.env ?? 'local';

  await runMigration({
    env,
    force: true, // Skip confirmation for deploy command
    dryRun: false,
  });
}
