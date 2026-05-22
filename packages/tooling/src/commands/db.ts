/**
 * Database-related CLI commands
 *
 * Environment support:
 * - local: Uses DATABASE_URL from .env (default)
 * - dev: Uses Railway CLI with development environment
 * - prod: Uses Railway CLI with production environment
 */

import type { CAC } from 'cac';
import type { Environment } from '../utils/env-runner.js';

// Reused across most db: commands.
const ENV_OPTION_FLAG = '--env <env>';
const ENV_OPTION_DESC = 'Environment: local, dev, or prod';
const MIGRATIONS_PATH_OPTION_FLAG = '--migrations-path <path>';
const MIGRATIONS_PATH_OPTION_DESC = 'Path to prisma migrations directory';

export function registerDbCommands(cli: CAC): void {
  // Migration status - shows applied, pending, and failed migrations
  cli
    .command('db:status', 'Show migration status (applied, pending, failed)')
    .option(ENV_OPTION_FLAG, ENV_OPTION_DESC, { default: 'local' })
    .option(MIGRATIONS_PATH_OPTION_FLAG, MIGRATIONS_PATH_OPTION_DESC)
    .action(async (options: { env?: Environment; migrationsPath?: string }) => {
      const { getMigrationStatus } = await import('../db/migration-status.js');
      await getMigrationStatus(options);
    });

  // Run migrations - interactive with safety checks
  cli
    .command('db:migrate', 'Run pending migrations')
    .option(ENV_OPTION_FLAG, ENV_OPTION_DESC, { default: 'local' })
    .option('--force', 'Skip confirmation for production')
    .option('--dry-run', 'Show what would be applied without running')
    .action(async (options: { env?: Environment; force?: boolean; dryRun?: boolean }) => {
      const { runMigration } = await import('../db/run-migration.js');
      await runMigration(options);
    });

  // Deploy migrations - non-interactive for CI/scripts
  cli
    .command('db:deploy', 'Deploy migrations (non-interactive, for CI)')
    .option(ENV_OPTION_FLAG, ENV_OPTION_DESC, { default: 'local' })
    .action(async (options: { env?: Environment }) => {
      const { deployMigration } = await import('../db/run-migration.js');
      await deployMigration(options);
    });

  // Check drift - now with environment support
  cli
    .command('db:check-drift', 'Check for migration drift between schema and database')
    .option(ENV_OPTION_FLAG, ENV_OPTION_DESC, { default: 'local' })
    .option(MIGRATIONS_PATH_OPTION_FLAG, MIGRATIONS_PATH_OPTION_DESC)
    .action(async (options: { env?: Environment; migrationsPath?: string }) => {
      const { checkMigrationDrift } = await import('../db/check-migration-drift.js');
      await checkMigrationDrift(options);
    });

  // Fix drift - now with environment support
  cli
    .command('db:fix-drift [...migrations]', 'Fix migration drift issues')
    .option(ENV_OPTION_FLAG, ENV_OPTION_DESC, { default: 'local' })
    .option(MIGRATIONS_PATH_OPTION_FLAG, MIGRATIONS_PATH_OPTION_DESC)
    .action(
      async (migrations: string[], options: { env?: Environment; migrationsPath?: string }) => {
        const { fixMigrationDrift } = await import('../db/fix-migration-drift.js');
        await fixMigrationDrift(migrations, options);
      }
    );

  // Inspect database - now with environment support
  cli
    .command('db:inspect', 'Inspect database state')
    .option(ENV_OPTION_FLAG, ENV_OPTION_DESC, { default: 'local' })
    .option('--table <name>', 'Inspect specific table')
    .option('--indexes', 'Show only indexes')
    .action(async (options: { env?: Environment; table?: string; indexes?: boolean }) => {
      const { inspectDatabase } = await import('../db/inspect-database.js');
      await inspectDatabase(options);
    });

  // Safe migrate - create new migration with validation
  cli
    .command('db:safe-migrate', 'Create a safe migration with validation')
    .option(ENV_OPTION_FLAG, ENV_OPTION_DESC, { default: 'local' })
    .option('--name <name>', 'Migration name (will prompt if not provided)')
    .action(async (options: { env?: Environment; name?: string }) => {
      const { createSafeMigration } = await import('../db/create-safe-migration.js');
      await createSafeMigration(options);
    });

  // Check migration safety - detect dangerous patterns like dropped indexes
  cli
    .command('db:check-safety', 'Check migrations for dangerous patterns (dropped indexes, etc.)')
    .option('--migrations-path <path>', 'Path to migrations directory', {
      default: 'prisma/migrations',
    })
    .option('--verbose', 'Show detailed output')
    .option(
      '--summary',
      'Output only the standardized JSONL audit-summary line (for the audit-aggregator)'
    )
    .action(async (options: { migrationsPath?: string; verbose?: boolean; summary?: boolean }) => {
      const { checkMigrationSafety } = await import('../db/check-migration-safety.js');
      await checkMigrationSafety(options);
    });
}
