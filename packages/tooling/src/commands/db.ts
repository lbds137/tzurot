/**
 * Database-related CLI commands
 */

import type { CAC } from 'cac';

export function registerDbCommands(cli: CAC): void {
  cli
    .command('db:check-drift', 'Check for migration drift between schema and database')
    .option('--migrations-path <path>', 'Path to prisma migrations directory')
    .action(async (options: { migrationsPath?: string }) => {
      const { checkMigrationDrift } = await import('../db/check-migration-drift.js');
      await checkMigrationDrift(options);
    });

  cli
    .command('db:fix-drift [...migrations]', 'Fix migration drift issues')
    .option('--migrations-path <path>', 'Path to prisma migrations directory')
    .action(async (migrations: string[], options: { migrationsPath?: string }) => {
      const { fixMigrationDrift } = await import('../db/fix-migration-drift.js');
      await fixMigrationDrift(migrations, options);
    });

  cli
    .command('db:inspect', 'Inspect database state')
    .option('--table <name>', 'Inspect specific table')
    .option('--indexes', 'Show only indexes')
    .action(async (options: { table?: string; indexes?: boolean }) => {
      const { inspectDatabase } = await import('../db/inspect-database.js');
      await inspectDatabase(options);
    });

  cli.command('db:safe-migrate', 'Create a safe migration with validation').action(async () => {
    const { createSafeMigration } = await import('../db/create-safe-migration.js');
    await createSafeMigration();
  });
}
