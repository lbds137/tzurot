/**
 * Bulk Import
 *
 * Import all personalities from v2 data.
 *
 * TODO: Migrate from scripts/data/import-personality/bulk-import.ts
 */

import chalk from 'chalk';

export interface BulkImportOptions {
  dryRun?: boolean;
  skipMemories?: boolean;
}

export async function bulkImport(options: BulkImportOptions = {}): Promise<void> {
  console.log(chalk.yellow('⚠️  bulk-import not yet migrated to tooling package'));
  console.log(chalk.dim('   Original: scripts/data/import-personality/bulk-import.ts'));
  console.log(`\n   Options: ${JSON.stringify(options)}`);
  console.log('\nFor now, use: pnpm bulk-import');
}
