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

export function registerDbCommands(cli: CAC): void {
  // Migration status - shows applied, pending, and failed migrations
  cli
    .command('db:status', 'Show migration status (applied, pending, failed)')
    .option('--env <env>', 'Environment: local, dev, or prod', { default: 'local' })
    .option('--migrations-path <path>', 'Path to prisma migrations directory')
    .action(async (options: { env?: Environment; migrationsPath?: string }) => {
      const { getMigrationStatus } = await import('../db/migration-status.js');
      await getMigrationStatus(options);
    });

  // Run migrations - interactive with safety checks
  cli
    .command('db:migrate', 'Run pending migrations')
    .option('--env <env>', 'Environment: local, dev, or prod', { default: 'local' })
    .option('--force', 'Skip confirmation for production')
    .option('--dry-run', 'Show what would be applied without running')
    .action(async (options: { env?: Environment; force?: boolean; dryRun?: boolean }) => {
      const { runMigration } = await import('../db/run-migration.js');
      await runMigration(options);
    });

  // Deploy migrations - non-interactive for CI/scripts
  cli
    .command('db:deploy', 'Deploy migrations (non-interactive, for CI)')
    .option('--env <env>', 'Environment: local, dev, or prod', { default: 'local' })
    .action(async (options: { env?: Environment }) => {
      const { deployMigration } = await import('../db/run-migration.js');
      await deployMigration(options);
    });

  // Check drift - now with environment support
  cli
    .command('db:check-drift', 'Check for migration drift between schema and database')
    .option('--env <env>', 'Environment: local, dev, or prod', { default: 'local' })
    .option('--migrations-path <path>', 'Path to prisma migrations directory')
    .action(async (options: { env?: Environment; migrationsPath?: string }) => {
      const { checkMigrationDrift } = await import('../db/check-migration-drift.js');
      await checkMigrationDrift(options);
    });

  // Fix drift - now with environment support
  cli
    .command('db:fix-drift [...migrations]', 'Fix migration drift issues')
    .option('--env <env>', 'Environment: local, dev, or prod', { default: 'local' })
    .option('--migrations-path <path>', 'Path to prisma migrations directory')
    .action(
      async (migrations: string[], options: { env?: Environment; migrationsPath?: string }) => {
        const { fixMigrationDrift } = await import('../db/fix-migration-drift.js');
        await fixMigrationDrift(migrations, options);
      }
    );

  // Inspect database - now with environment support
  cli
    .command('db:inspect', 'Inspect database state')
    .option('--env <env>', 'Environment: local, dev, or prod', { default: 'local' })
    .option('--table <name>', 'Inspect specific table')
    .option('--indexes', 'Show only indexes')
    .action(async (options: { env?: Environment; table?: string; indexes?: boolean }) => {
      const { inspectDatabase } = await import('../db/inspect-database.js');
      await inspectDatabase(options);
    });

  // Safe migrate - create new migration with validation
  cli.command('db:safe-migrate', 'Create a safe migration with validation').action(async () => {
    const { createSafeMigration } = await import('../db/create-safe-migration.js');
    await createSafeMigration();
  });
}
