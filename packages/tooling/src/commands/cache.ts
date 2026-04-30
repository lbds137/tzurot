/**
 * Cache Commands
 *
 * Commands for managing Turborepo cache.
 */

import type { CAC } from 'cac';

import { validateEnvironment, type Environment } from '../utils/env-runner.js';

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

  cli
    .command(
      'cache:clear-credit-exhaustion',
      'Clear an OpenRouter credit-exhaustion cache entry (operator escape valve)'
    )
    .option('--env <env>', 'Environment to target (local, dev, prod)', { default: 'local' })
    .option('--user-id <discordId>', 'Clear cache for a specific BYOK user (Discord snowflake)')
    .option('--system', 'Clear the system-bucket entry (guest mode / system-key fallback)')
    .example('ops cache:clear-credit-exhaustion --env prod --user-id 278863839632818186')
    .example('ops cache:clear-credit-exhaustion --env dev --system')
    .action(async (options: { env: string; userId?: string; system?: boolean }) => {
      validateEnvironment(options.env);
      const { clearCreditExhaustion } = await import('../cache/clear-credit-exhaustion.js');
      await clearCreditExhaustion({
        env: options.env as Environment,
        userId: options.userId,
        system: options.system,
      });
    });
}
