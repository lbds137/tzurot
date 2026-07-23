/**
 * Retention CLI commands
 *
 * Data-minimization tooling for the inactivity retention/purge epic. Phase 1
 * ships only the historical backfill of the tracking clock; the preview + purge
 * commands arrive in later phases.
 */

import type { CAC } from 'cac';
import type { Environment } from '../utils/env-runner.js';

const ENV_OPTION = '--env <env>';
const ENV_OPTION_DESC = 'Environment: local, dev, or prod';
const ENV_OPTION_DEFAULT = { default: 'dev' } as const;
const FORCE_OPTION_DESC = 'Skip production confirmation prompt';

export function registerRetentionCommands(cli: CAC): void {
  cli
    .command(
      'retention:backfill-last-active',
      'Seed users.last_active_at from historical activity (forward-only, idempotent)'
    )
    .option(ENV_OPTION, ENV_OPTION_DESC, ENV_OPTION_DEFAULT)
    .option('--dry-run', 'Report the eligible-user staleness buckets without updating')
    .option('--force', FORCE_OPTION_DESC)
    .action(async (options: { env?: Environment; dryRun?: boolean; force?: boolean }) => {
      const { backfillLastActive } = await import('../retention/backfill-last-active.js');
      await backfillLastActive({
        env: options.env ?? 'dev',
        dryRun: options.dryRun,
        force: options.force,
      });
    });
}
