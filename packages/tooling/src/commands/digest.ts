/**
 * Recent-days digest CLI commands.
 *
 * `packages/tooling/src/commands/memory.ts` is already near its line budget,
 * so this is its own router rather than another export from that file.
 */

import type { CAC } from 'cac';
import type { Environment } from '../utils/env-runner.js';
import { parseIntFlag } from '../utils/cli-args.js';
import { UsageError } from '../utils/errors.js';

const ENV_OPTION = '--env <env>';
const ENV_OPTION_DESC = 'Environment: local, dev, or prod';
const ENV_OPTION_DEFAULT = { default: 'dev' } as const;
const FORCE_OPTION_DESC = 'Skip production confirmation prompt';

export function registerDigestCommands(cli: CAC): void {
  cli
    .command(
      'digest:candidates',
      'Report the (persona, personality) pairs currently due for a recent-days digest generation — read-only'
    )
    .option(ENV_OPTION, ENV_OPTION_DESC, ENV_OPTION_DEFAULT)
    .option('--limit <n>', 'Cap on returned candidates (default: the sweep’s per-tick cap)')
    .action(async (options: { env?: Environment; limit?: string }) => {
      const limit = parseIntFlag(options.limit, '--limit', { min: 1 });
      const { digestCandidates } = await import('../digest/candidates.js');
      await digestCandidates({
        env: options.env ?? 'dev',
        limit,
      });
    });

  cli
    .command(
      'digest:refresh',
      'Force one (persona, personality) pair back to pending with a fresh requested_at, bypassing the routine regen interval; the next attempt consumes the stamp, success or failure'
    )
    .option(ENV_OPTION, ENV_OPTION_DESC, ENV_OPTION_DEFAULT)
    .option('--persona <uuid>', 'Persona UUID (required)')
    .option('--personality <slug>', 'Personality slug (required)')
    .option('--force', FORCE_OPTION_DESC)
    .option('--dry-run', 'Report what would change without writing')
    .action(
      async (options: {
        env?: Environment;
        persona?: string;
        personality?: string;
        force?: boolean;
        dryRun?: boolean;
      }) => {
        if (options.persona === undefined) {
          throw new UsageError('--persona is required');
        }
        if (options.personality === undefined) {
          throw new UsageError('--personality is required');
        }
        const { digestRefresh } = await import('../digest/refresh.js');
        await digestRefresh({
          env: options.env ?? 'dev',
          personaId: options.persona,
          personalitySlug: options.personality,
          force: options.force,
          dryRun: options.dryRun,
        });
      }
    );
}
