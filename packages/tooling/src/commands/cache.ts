/**
 * Cache Commands
 *
 * Commands for managing Turborepo cache.
 */

import type { CAC } from 'cac';

import { validateEnvironment, type Environment } from '../utils/env-runner.js';
import { rawOptionValue, parseIntFlag } from '../utils/cli-args.js';
import { UsageError } from '../utils/errors.js';

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

/**
 * Default context width for `--show-divergence`, in chars per side.
 *
 * Sized to hold one whole `<participant>`/`<character_participant>` element's
 * opening lines or a couple of chat_log messages — enough to name the changed
 * entity, short enough that ten pairs still fit on a screen.
 */
const PREFIX_DIFF_DEFAULT_DIVERGENCE_CHARS = 240;

/** Upper bound on `--show-divergence`, to keep one pair inside a terminal page. */
const PREFIX_DIFF_MAX_DIVERGENCE_CHARS = 4000;

/**
 * Resolve `--show-divergence` into a char count, or undefined when off.
 *
 * cac gives an optional-value flag three shapes — absent, bare (`true`), or a
 * string — and only the last is a width. Bare means "on, at the default", so
 * `parseIntFlag` is reached only for an explicit value; handing it `true`
 * would reject a spelling the flag deliberately accepts.
 */
export function resolveDivergenceChars(
  raw: boolean | number | string | undefined
): number | undefined {
  if (raw === undefined || raw === false) {
    return undefined;
  }
  if (raw === true) {
    return PREFIX_DIFF_DEFAULT_DIVERGENCE_CHARS;
  }
  // The `??` satisfies parseIntFlag's SIGNATURE, not a runtime case: it returns
  // undefined only for an absent flag, and `raw` is known defined by here (the
  // undefined/false/true spellings all returned above). A bad value throws
  // rather than falling back — do not read this as a silent default.
  return (
    parseIntFlag(raw, '--show-divergence', { min: 1, max: PREFIX_DIFF_MAX_DIVERGENCE_CHARS }) ??
    PREFIX_DIFF_DEFAULT_DIVERGENCE_CHARS
  );
}

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
    .option(
      '--show-divergence [chars]',
      `Print the differing text around each divergence (default ${PREFIX_DIFF_DEFAULT_DIVERGENCE_CHARS} chars/side, max ${PREFIX_DIFF_MAX_DIVERGENCE_CHARS})`
    )
    .example('ops cache:prefix-diff --env dev --channel 123456789012345678')
    .example('ops cache:prefix-diff --env prod --channel 123456789012345678 --limit 10')
    .example('ops cache:prefix-diff --env prod --channel 123456789012345678 --show-divergence')
    .action(
      async (options: {
        env: string;
        personality?: string;
        limit: number;
        showDivergence?: boolean | number | string;
      }) => {
        validateEnvironment(options.env);
        // Snowflakes MUST come from the raw argv: cac number-coerces digit-only
        // values and a snowflake exceeds MAX_SAFE_INTEGER (see utils/cli-args.ts).
        const channelId = rawOptionValue(process.argv, '--channel');
        if (channelId === undefined || channelId.length === 0) {
          throw new UsageError('--channel is required (Discord channel snowflake)');
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
          showDivergence: resolveDivergenceChars(options.showDivergence),
        });
      }
    );

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
