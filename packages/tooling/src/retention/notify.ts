/**
 * `pnpm ops retention:notify` — send the retention warning DM to every
 * reachable-but-inactive user (Retention Phase 3, the reachable branch).
 *
 * Non-destructive but outward-facing: each recipient gets a DM stating a
 * concrete deletion date, and every send starts a 30-day grace clock. The
 * safeguards, in the order a run hits them:
 *
 *   1. `--dry-run` resolves and prints the cohort without enqueuing.
 *   2. In EVERY environment, `requireProductionConfirmation` is the
 *      manual-approval gate — `--force` skips the PROMPT only. Dev is not
 *      exempt: dev mirrors prod's users via sync, so a dev run DMs REAL
 *      users a deletion warning from the dev bot and starts their grace
 *      clocks.
 *   3. The gateway refuses the run when the cohort exceeds the hard-ceiling
 *      share of the userbase; `--breaker-override` is the deliberate,
 *      separate flag. The first real run is EXPECTED to trip the softer warn
 *      annotation (~15-18%, the backfilled zombie cohort) — that prints, and
 *      the run proceeds.
 *
 * **Resuming is re-running.** A sent notice stamps the user's grace clock,
 * which removes them from the notify cohort — an interrupted or partially
 * failed run picks up exactly the un-warned remainder next invocation.
 *
 * The command returns at ENQUEUE time; the DMs go out via bot-client's
 * worker (1/sec pacing), which posts a per-batch tally to the owner channel.
 */

import chalk from 'chalk';
import type { RetentionNotifyResponse } from '@tzurot/common-types/schemas/api/internal';
import {
  type Environment,
  validateEnvironment,
  showEnvironmentBanner,
  requireProductionConfirmation,
} from '../utils/env-runner.js';
import { resolveServiceClientOrExit } from '../utils/gateway-client.js';

export interface RetentionNotifyOptions {
  env: Environment;
  /** Resolve and print the cohort without enqueuing anything. */
  dryRun?: boolean;
  /** Skip the confirmation prompt (every env prompts). Does NOT bypass the breaker. */
  force?: boolean;
  /** Proceed despite the hard-ceiling breaker. Deliberately not `--force`. */
  breakerOverride?: boolean;
}

/** Print a resolved run (dry or real). Exported for testing. */
export function renderNotifyRun(result: RetentionNotifyResponse): void {
  if (result.status === 'empty') {
    console.log(chalk.green('\nNobody to warn — no reachable user is past the inactivity window.'));
    console.log(chalk.dim(`  cohort: 0 of ${String(result.userbaseCount)} users`));
    return;
  }

  console.log(chalk.bold('\nNotify cohort (reachable, inactive, not yet warned):'));
  for (const user of result.recipients) {
    console.log(`  ${user.discordId}  inactive since ${user.inactiveSince.slice(0, 10)}`);
  }
  console.log(
    `\n  cohort: ${String(result.cohortSize)} of ${String(result.userbaseCount)} users ` +
      `(${String(result.percentOfUserbase)}% of the userbase)`
  );

  if (result.breakerWarning) {
    console.log(
      chalk.yellow(
        '\n⚠️  Breaker warning: the cohort exceeds the warn share of the userbase. On the FIRST ' +
          'real run this is expected (the backfilled zombie cohort); on later runs, confirm real ' +
          'churn before proceeding.'
      )
    );
  }

  if (result.status === 'refused_breaker') {
    console.error(chalk.red(`\n${result.breakerDetail ?? 'Hard-ceiling breaker tripped.'}`));
    return;
  }
  if (result.status === 'enqueued') {
    console.log(
      chalk.green(
        `\nEnqueued ${String(result.batchesEnqueued)} batch(es). DMs go out at 1/sec via ` +
          'bot-client; delivery tallies arrive in the owner channel as batches complete.'
      )
    );
  }
}

/** Entry point for `pnpm ops retention:notify`. */
export async function retentionNotify(options: RetentionNotifyOptions): Promise<void> {
  const { env, dryRun = false, force = false, breakerOverride = false } = options;
  validateEnvironment(env);
  showEnvironmentBanner(env);

  const client = resolveServiceClientOrExit(env);
  if (client === null) {
    return;
  }

  // Always resolve as a dry run first: the operator sees exactly who would be
  // warned BEFORE the prod confirmation asks them to vouch for it.
  const previewResult = await client.retentionNotify({ dryRun: true });
  if (!previewResult.ok) {
    console.error(
      chalk.red(
        `\nFailed to resolve the notify cohort (${previewResult.kind}): ${previewResult.error}`
      )
    );
    process.exitCode = 1;
    return;
  }
  renderNotifyRun(previewResult.data);

  if (dryRun) {
    console.log(chalk.yellow('\nDry run — nothing was enqueued.'));
    return;
  }
  if (previewResult.data.status === 'empty') {
    return;
  }
  // The preview call runs the same server-side breaker (it precedes the
  // dry-run branch), so an over-ceiling cohort is refused HERE — asking the
  // operator to confirm an action the server just refused would be noise.
  if (previewResult.data.status === 'refused_breaker' && !breakerOverride) {
    console.log(
      chalk.yellow('\nRe-run with --breaker-override once you have confirmed the cohort is real.')
    );
    process.exitCode = 1;
    return;
  }

  if (!force) {
    if (env === 'dev') {
      // The shared gate's banner names PRODUCTION unconditionally; on a dev
      // run the reason this still reaches real people has to be stated, or
      // the operator reads the prompt as boilerplate. DEV ONLY: `local` is
      // not part of the dev<->prod sync, so it gets the plain prompt.
      console.log(chalk.red.bold('\n⚠️  A DEV NOTIFY IS NOT A SANDBOX OPERATION'));
      console.log(
        chalk.red(
          "dev mirrors prod's users via sync: this run DMs REAL users a deletion\n" +
            'warning from the dev bot and starts their 30-day grace clocks.'
        )
      );
    }
    await requireProductionConfirmation(
      `DM a deletion warning to ${String(previewResult.data.cohortSize)} inactive users ` +
        '(starts their 30-day grace clocks)' +
        (env === 'dev' ? ' via DEV, reaching the mirrored prod userbase' : '')
    );
  }

  const runResult = await client.retentionNotify({
    breakerOverride,
    runContext: `ops retention:notify (${env})`,
  });
  if (!runResult.ok) {
    console.error(chalk.red(`\nNotify run failed (${runResult.kind}): ${runResult.error}`));
    process.exitCode = 1;
    return;
  }
  renderNotifyRun(runResult.data);
  if (runResult.data.status === 'refused_breaker') {
    process.exitCode = 1;
  }
}
