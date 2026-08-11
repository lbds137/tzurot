/**
 * Retention CLI commands
 *
 * Data-minimization tooling for the inactivity retention/purge epic. Phase 1
 * ships only the historical backfill of the tracking clock; the preview + purge
 * commands arrive in later phases.
 */

import type { CAC } from 'cac';
import { rawOptionValue } from '../utils/cli-args.js';
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

  cli
    .command(
      'retention:preview',
      'Report the purge-eligible cohort and its character impact (read-only)'
    )
    .option(ENV_OPTION, ENV_OPTION_DESC, ENV_OPTION_DEFAULT)
    .action(async (options: { env?: Environment }) => {
      const { retentionPreview } = await import('../retention/preview.js');
      await retentionPreview({ env: options.env ?? 'dev' });
    });

  cli
    .command('retention:purge', 'ERASE the purge-eligible cohort, one account per call')
    .option(ENV_OPTION, ENV_OPTION_DESC, ENV_OPTION_DEFAULT)
    .option('--dry-run', 'Report the cohort without erasing anything (same as retention:preview)')
    .option('--force', FORCE_OPTION_DESC)
    .option('--exclude <ids>', 'Comma-separated Discord IDs to skip for this run only')
    // Deliberately NOT covered by --force: --force asserts the operator is
    // present, which says nothing about whether an implausibly large cohort is
    // real churn or a tracking-signal glitch.
    .option('--breaker-override', 'Proceed even though the cohort exceeds the safety ceiling')
    .action(
      async (options: {
        env?: Environment;
        dryRun?: boolean;
        force?: boolean;
        // exclude is read from argv below, not from cac's parsed value.
        breakerOverride?: boolean;
      }) => {
        const { retentionPurge } = await import('../retention/purge.js');
        await retentionPurge({
          env: options.env ?? 'dev',
          dryRun: options.dryRun,
          force: options.force,
          // A SINGLE all-digit id is number-coerced by cac's parser, and
          // parseExcludes then calls .trim() on a number — so the one flag
          // protecting an account from a purge run crashes on its documented
          // single-user case. (A comma-list survives: the comma defeats the
          // coercion.) Read verbatim, like every other id-valued flag.
          exclude: rawOptionValue(process.argv, '--exclude'),
          breakerOverride: options.breakerOverride,
        });
      }
    );

  cli
    .command(
      'retention:notify',
      'DM the deletion warning to reachable-but-inactive users (starts grace clocks)'
    )
    .option(ENV_OPTION, ENV_OPTION_DESC, ENV_OPTION_DEFAULT)
    .option('--dry-run', 'Resolve and print the notify cohort without enqueuing anything')
    .option('--force', FORCE_OPTION_DESC)
    // Same two-flag discipline as the purge: --force asserts the operator is
    // present; only --breaker-override vouches for an implausibly large cohort.
    .option('--breaker-override', 'Proceed even though the cohort exceeds the safety ceiling')
    .action(
      async (options: {
        env?: Environment;
        dryRun?: boolean;
        force?: boolean;
        breakerOverride?: boolean;
      }) => {
        const { retentionNotify } = await import('../retention/notify.js');
        await retentionNotify({
          env: options.env ?? 'dev',
          dryRun: options.dryRun,
          force: options.force,
          breakerOverride: options.breakerOverride,
        });
      }
    );

  cli
    .command(
      'retention:reconcile-off-db',
      'Retry avatar cleanup a completed purge still owes (idempotent)'
    )
    .option(ENV_OPTION, ENV_OPTION_DESC, ENV_OPTION_DEFAULT)
    .action(async (options: { env?: Environment }) => {
      const { retentionReconcileOffDb } = await import('../retention/reconcile-off-db.js');
      await retentionReconcileOffDb({ env: options.env ?? 'dev' });
    });
}
