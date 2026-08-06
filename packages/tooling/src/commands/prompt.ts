/**
 * Prompt Commands
 *
 * Prompt-assembly measurement tooling (the caching epic's harnesses).
 */

import type { CAC } from 'cac';

import { validateEnvironment, type Environment } from '../utils/env-runner.js';
import { rawOptionValue, parseIntFlag } from '../utils/cli-args.js';

export function registerPromptCommands(cli: CAC): void {
  cli
    .command(
      'prompt:mine-voice-probes',
      'Mine OWNER-ONLY conversation probes for the voice-consistency harness (Phase-1→2 exit gate)'
    )
    .option('--env <env>', 'Environment to target (local, dev, prod)', { default: 'dev' })
    .option('--owner <discordId>', 'REQUIRED: operator Discord id — only their conversations mine')
    .option('--personalities <slugs>', 'Comma-separated personality slugs (overrides auto-pick)')
    .option('--count <n>', 'Personalities to auto-pick (default 4)')
    .option('--depths <csv>', 'Probe depths in prior turns (default 5,10,15,20,25,30)')
    .option('--cutoff <iso>', 'Anchors strictly before this instant (default: beta.190 deploy)')
    .option('--out <dir>', 'Output directory (default reports/voice-consistency)')
    .example('ops prompt:mine-voice-probes --env dev --owner 278863839632818186')
    .example(
      'ops prompt:mine-voice-probes --env dev --owner <id> --personalities lilith,the-fluffle'
    )
    .action(
      async (options: {
        env: string;
        // cac/mri number-coerces digit-only values at tokenize time, so any of
        // these can arrive as a number regardless of the declared shape.
        personalities?: string | number;
        count?: string | number;
        depths?: string | number;
        cutoff?: string;
        out?: string;
      }) => {
        validateEnvironment(options.env);
        // Snowflakes MUST come from raw argv: cac number-coerces digit-only
        // values and a snowflake exceeds MAX_SAFE_INTEGER (see utils/cli-args.ts).
        const ownerDiscordId = rawOptionValue(process.argv, '--owner');
        if (ownerDiscordId === undefined || ownerDiscordId.length === 0) {
          throw new Error(
            '--owner is required (operator Discord snowflake) — the privacy scope is explicit, never implied.'
          );
        }
        const count = parseIntFlag(options.count, '--count', { min: 1 });
        const { parseDepthsOption } = await import('../prompt/voice-probes.js');
        const { mineVoiceProbes } = await import('../prompt/mine-voice-probes.js');
        await mineVoiceProbes({
          env: options.env as Environment,
          ownerDiscordId,
          personalitySlugs:
            options.personalities === undefined
              ? undefined
              : String(options.personalities)
                  .split(',')
                  .map(slug => slug.trim())
                  .filter(slug => slug.length > 0),
          personalityCount: count,
          depths: parseDepthsOption(options.depths),
          cutoff: options.cutoff,
          outDir: options.out,
        });
      }
    );
}
