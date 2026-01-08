/**
 * Data import/export CLI commands
 */

import type { CAC } from 'cac';

export function registerDataCommands(cli: CAC): void {
  cli
    .command('data:import <personality>', 'Import a personality from v2 data')
    .option('--dry-run', 'Preview changes without applying')
    .option('--skip-memories', 'Skip memory import')
    .action(async (personality: string, options: { dryRun?: boolean; skipMemories?: boolean }) => {
      const { importPersonality } = await import('../data/import-personality.js');
      await importPersonality(personality, options);
    });

  cli
    .command('data:bulk-import', 'Bulk import all personalities')
    .option('--dry-run', 'Preview changes without applying')
    .option('--skip-memories', 'Skip memory import')
    .action(async (options: { dryRun?: boolean; skipMemories?: boolean }) => {
      const { bulkImport } = await import('../data/bulk-import.js');
      await bulkImport(options);
    });

  cli.command('data:backup', 'Backup personality data').action(async () => {
    const { backupPersonalities } = await import('../data/backup.js');
    await backupPersonalities();
  });
}
