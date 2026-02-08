/**
 * Bulk Import
 *
 * Import all personalities from v2 data.
 *
 * @deprecated This is a stub. Use `pnpm bulk-import` until migrated.
 * @todo Migrate from scripts/data/import-personality/bulk-import.ts
 */

import chalk from 'chalk';

interface BulkImportOptions {
  dryRun?: boolean;
  skipMemories?: boolean;
}

/** @deprecated Stub - not yet implemented */
export async function bulkImport(options: BulkImportOptions = {}): Promise<void> {
  console.log(chalk.yellow('⚠️  bulk-import not yet migrated to tooling package'));
  console.log(chalk.dim('   Original: scripts/data/import-personality/bulk-import.ts'));
  console.log(`\n   Options: ${JSON.stringify(options)}`);
  console.log('\nFor now, use: pnpm bulk-import');
}
