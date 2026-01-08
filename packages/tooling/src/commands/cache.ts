/**
 * Cache Commands
 *
 * Commands for managing Turborepo cache.
 */

import type { CAC } from 'cac';

export function registerCacheCommands(cli: CAC): void {
  cli.command('cache:inspect', 'Inspect Turborepo cache size and status').action(async () => {
    const { inspectCache } = await import('../cache/inspect-cache.js');
    await inspectCache();
  });

  cli
    .command('cache:clear', 'Clear Turborepo cache to force fresh builds')
    .option('--dry-run', 'Preview what would be deleted')
    .action(async (options: { dryRun?: boolean }) => {
      const { clearCache } = await import('../cache/clear-cache.js');
      await clearCache(options);
    });
}
