/**
 * `pnpm ops retention:reconcile-off-db` — retry the off-DB cleanup a purge
 * still owes (Retention Phase 2, D15).
 *
 * A purge commits its DB transaction first, then unlinks the deleted
 * characters' avatars. If that unlink fails, the rows are already gone and the
 * files are still publicly downloadable — so the purge audit ledger records the
 * outstanding work and this command drains it.
 *
 * `retention:purge` calls the same endpoint at the end of every run, so this
 * exists for the case where that run itself was interrupted, or where an
 * operator wants to clear the queue without purging anything. It mutates only
 * off-DB state (no rows are deleted), so there is no production confirmation.
 */

import chalk from 'chalk';
import {
  type Environment,
  validateEnvironment,
  showEnvironmentBanner,
} from '../utils/env-runner.js';
import { resolveServiceClientOrExit } from '../utils/gateway-client.js';

export interface RetentionReconcileOptions {
  env: Environment;
}

/** Entry point for `pnpm ops retention:reconcile-off-db`. */
export async function retentionReconcileOffDb(options: RetentionReconcileOptions): Promise<void> {
  const { env } = options;
  validateEnvironment(env);
  showEnvironmentBanner(env);

  const client = resolveServiceClientOrExit(env);
  if (client === null) {
    return;
  }

  const result = await client.retentionReconcileOffDb();
  if (!result.ok) {
    console.error(chalk.red(`\nOff-DB reconciliation failed (${result.kind}): ${result.error}`));
    process.exitCode = 1;
    return;
  }

  const { settled, stillFailing } = result.data;
  if (settled + stillFailing === 0) {
    console.log(chalk.green('\nNothing owed — every purge has completed its off-DB cleanup.'));
    return;
  }
  console.log(chalk.bold('\nOff-DB reconciliation:'));
  console.log(`  settled:       ${String(settled)}`);
  if (stillFailing > 0) {
    console.log(
      chalk.red(
        `  still failing: ${String(stillFailing)} — check the gateway logs for the ` +
          'underlying avatar-unlink error; the ledger keeps them queued for the next run.'
      )
    );
  }
}
