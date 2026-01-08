/**
 * Cache Cleaner
 *
 * Clear Turborepo cache to force fresh builds.
 */

import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';

export interface ClearCacheOptions {
  dryRun?: boolean;
}

export async function clearCache(options: ClearCacheOptions = {}): Promise<void> {
  const { dryRun = false } = options;

  console.log(chalk.bold('\n🧹 Turborepo Cache Cleaner\n'));

  const turboDir = path.join(process.cwd(), '.turbo');

  if (!fs.existsSync(turboDir)) {
    console.log(chalk.yellow('  No cache found. Nothing to clear.'));
    return;
  }

  if (dryRun) {
    console.log(chalk.yellow('  [DRY RUN] Would delete: .turbo/'));
    console.log(chalk.dim('  Run without --dry-run to actually clear the cache.'));
    return;
  }

  try {
    fs.rmSync(turboDir, { recursive: true, force: true });
    console.log(chalk.green('  ✓ Cache cleared successfully'));
    console.log(chalk.dim('  Next build will be a full rebuild.'));
  } catch (error) {
    console.error(chalk.red('  ✗ Failed to clear cache'));
    if (error instanceof Error) {
      console.error(chalk.dim(`    ${error.message}`));
    }
  }
}
