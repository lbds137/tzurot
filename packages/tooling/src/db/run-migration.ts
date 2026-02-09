/**
 * Run Migration Command
 *
 * Applies pending migrations using `prisma migrate deploy` + `prisma generate`.
 *
 * Uses `migrate deploy` (not `migrate dev`) for ALL environments because:
 * 1. Migration creation is handled separately by `db:safe-migrate`
 * 2. `migrate dev` detects schema drift from sanitized indexes and prompts
 *    for a new migration name, which blocks non-interactive environments
 * 3. `migrate deploy` just applies pending migrations — no drift detection,
 *    no interactive prompts, no TTY requirement
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

interface RunMigrationOptions {
  env?: Environment;
  force?: boolean;
  dryRun?: boolean;
}

/**
 * Run migrations for local environment.
 *
 * Uses `prisma migrate deploy` + `prisma generate` to apply pending migrations
 * without interactive prompts or drift detection.
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

  console.log(chalk.dim('\nRunning: npx prisma migrate deploy\n'));
  console.log(chalk.yellow('This will apply pending migrations.\n'));

  const deployResult = await runPrismaCommand('local', 'migrate', ['deploy']);
  if (deployResult.exitCode !== 0) {
    console.error(chalk.red('\n❌ Migration failed'));
    process.exit(1);
  }

  // migrate deploy doesn't regenerate client, so run generate separately
  console.log(chalk.dim('\nGenerating Prisma client...\n'));
  const generateResult = await runPrismaCommand('local', 'generate', []);
  if (generateResult.exitCode !== 0) {
    console.error(chalk.red('\n❌ Prisma generate failed'));
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
    console.error(chalk.dim('  1. Go to: https://railway.app → Project → PostgreSQL → Backups'));
    console.error(chalk.dim('  2. Select the backup taken before migration'));
    console.error(chalk.dim('  3. Click "Restore" and confirm'));
    console.error(chalk.dim('\nOr mark migration as rolled back (for partial failures):'));
    console.error(chalk.dim('  npx prisma migrate resolve --rolled-back <migration-name>'));
    console.error(
      chalk.dim(
        '\nSee: https://www.prisma.io/docs/reference/api-reference/command-reference#migrate-resolve'
      )
    );
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
  if (env === 'prod' && !dryRun) {
    if (force) {
      // AUDIT: Log when --force bypasses confirmation for prod operations
      console.warn(chalk.yellow('⚠️  Using --force flag - confirmation bypassed for PRODUCTION'));
    } else {
      const confirmed = await confirmProductionOperation('run migrations');
      if (!confirmed) {
        console.log(chalk.yellow('\n⛔ Operation cancelled'));
        process.exit(0);
      }
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
