/**
 * Backup Personalities
 *
 * Backup personality data to JSON files.
 *
 * TODO: Migrate from scripts/data/backup-personalities-data.js
 */

import chalk from 'chalk';

export async function backupPersonalities(): Promise<void> {
  console.log(chalk.yellow('⚠️  backup-personalities not yet migrated to tooling package'));
  console.log(chalk.dim('   Original: scripts/data/backup-personalities-data.js'));
  console.log('\nFor now, use the original script.');
}
