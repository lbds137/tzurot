/**
 * Import Personality
 *
 * Import a single personality from v2 data.
 *
 * TODO: Migrate from scripts/data/import-personality/
 */

import chalk from 'chalk';

export interface ImportOptions {
  dryRun?: boolean;
  skipMemories?: boolean;
}

export async function importPersonality(
  personality: string,
  options: ImportOptions = {}
): Promise<void> {
  console.log(chalk.yellow('⚠️  import-personality not yet migrated to tooling package'));
  console.log(chalk.dim('   Original: scripts/data/import-personality/import-personality.ts'));
  console.log(`\n   Would import: ${personality}`);
  console.log(`   Options: ${JSON.stringify(options)}`);
  console.log('\nFor now, use: pnpm import-personality');
}
