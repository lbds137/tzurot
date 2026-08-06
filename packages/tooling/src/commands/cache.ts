/**
 * Cache Commands
 *
 * Commands for managing Turborepo cache.
 */

import type { CAC } from 'cac';

import { validateEnvironment, type Environment } from '../utils/env-runner.js';
import { rawOptionValue, parseIntFlag } from '../utils/cli-args.js';

/**
 * Upper bound on `cache:prefix-diff --limit` (pair count).
 *
 * The fetch runs in a subprocess whose stdout carries `limit + 1` full
 * diagnostic payloads — every compared pair costs two complete system
 * prompts — over a 128MB `maxBuffer` (see cache/prefix-diff.ts). Against a
 * prod channel with large prompts an unbounded limit overflows that buffer
 * and the run dies mid-transfer instead of producing a diff.
 */
const PREFIX_DIFF_MAX_PAIRS = 100;

/**
 * Default `cache:prefix-diff --limit`. Named so the cac option default and
 * the post-parse fallback cannot drift apart — cac always supplies the
 * default, but `parseIntFlag` is typed to allow an absent flag.
 */
const PREFIX_DIFF_DEFAULT_PAIRS = 5;

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
      'cache:prefix-diff',
      'Diff consecutive requests’ system prompts to diagnose provider-cache misses'
    )
    .option('--env <env>', 'Environment to target (local, dev, prod)', { default: 'dev' })
    .option('--channel <channelId>', 'Discord channel to trace (snowflake)')
    .option('--personality <uuid>', 'Restrict to one personality')
    .option('--limit <pairs>', `Consecutive pairs to compare (max ${PREFIX_DIFF_MAX_PAIRS})`, {
      default: PREFIX_DIFF_DEFAULT_PAIRS,
    })
    .example('ops cache:prefix-diff --env dev --channel 123456789012345678')
    .example('ops cache:prefix-diff --env prod --channel 123456789012345678 --limit 10')
    .action(async (options: { env: string; personality?: string; limit: number }) => {
      validateEnvironment(options.env);
      // Snowflakes MUST come from the raw argv: cac number-coerces digit-only
      // values and a snowflake exceeds MAX_SAFE_INTEGER (see utils/cli-args.ts).
      const channelId = rawOptionValue(process.argv, '--channel');
      if (channelId === undefined || channelId.length === 0) {
        throw new Error('--channel is required (Discord channel snowflake)');
      }
      const limit =
        parseIntFlag(options.limit, '--limit', { min: 1, max: PREFIX_DIFF_MAX_PAIRS }) ??
        PREFIX_DIFF_DEFAULT_PAIRS;
      const { runPrefixDiff } = await import('../cache/prefix-diff.js');
      await runPrefixDiff({
        env: options.env as Environment,
        channelId,
        personalityId: options.personality,
        limit,
      });
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
    .action(async (options: { env: string; system?: boolean }) => {
      validateEnvironment(options.env);
      // Raw argv for the same snowflake-precision reason as --channel above.
      const userId = rawOptionValue(process.argv, '--user-id');
      const { clearCreditExhaustion } = await import('../cache/clear-credit-exhaustion.js');
      await clearCreditExhaustion({
        env: options.env as Environment,
        userId,
        system: options.system,
      });
    });
}
