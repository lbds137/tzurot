/**
 * `pnpm ops retention:notify` — send BOTH grace-cycle notices to the
 * reachable branch (Retention Phase 3): the warning DM to every
 * reachable-but-inactive user, and the reminder DM to every already-warned
 * user whose warning has stood 23-30 days.
 *
 * Non-destructive but outward-facing: each recipient gets a DM stating a
 * concrete deletion date, a warning send starts a 30-day grace clock, and a
 * reminder send restates the same deadline. The safeguards, in the order a
 * run hits them:
 *
 *   1. `--dry-run` resolves and prints both cohorts without enqueuing.
 *   2. In EVERY environment, `requireProductionConfirmation` is the
 *      manual-approval gate — `--force` skips the PROMPT only. Dev is not
 *      exempt: dev mirrors prod's users via sync, so a dev run DMs REAL
 *      users a deletion warning or reminder from the dev bot and starts or
 *      restates their grace clocks.
 *   3. The gateway refuses the run when the WARNING cohort exceeds the
 *      hard-ceiling share of the userbase; `--breaker-override` is the
 *      deliberate, separate flag. The breaker is warning-only — the reminder
 *      cohort is bounded by prior warnings and never trips it. The first real
 *      run is EXPECTED to trip the softer warn annotation (~15-18%, the
 *      backfilled zombie cohort) — that prints, and the run proceeds.
 *   4. The real (non-dry) run is leased: taken AFTER the confirmation (an
 *      operator pondering the prompt must not hold it) and released in a
 *      finally on normal completion and on a thrown error. An interrupt
 *      (Ctrl-C) during the single enqueue call exits without releasing —
 *      deliberately unhandled, since the leased window is one short call —
 *      and the lease's TTL reclaims it.
 *
 * **Resuming is re-running.** A sent notice stamps the user's grace or
 * reminder clock, which removes them from the matching cohort — an
 * interrupted or partially failed run picks up exactly the un-notified
 * remainder next invocation.
 *
 * The command returns at ENQUEUE time; the DMs go out via bot-client's
 * worker (1/sec pacing), which posts a per-batch tally to the owner channel.
 */

import chalk from 'chalk';
import type { ServiceClient } from '@tzurot/clients';
import type { RetentionNotifyResponse } from '@tzurot/common-types/schemas/api/internal';
import {
  type Environment,
  validateEnvironment,
  showEnvironmentBanner,
  requireProductionConfirmation,
} from '../utils/env-runner.js';
import { resolveServiceClientOrExit } from '../utils/gateway-client.js';
import { beginRunLease, releaseRunLease } from './runLease.js';

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
    console.log(
      chalk.green('\nNobody to warn or remind — no reachable user is due for either notice.')
    );
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

  console.log(chalk.bold('\nReminder cohort (warned 23-30 days ago, not yet reminded):'));
  for (const user of result.reminderRecipients) {
    console.log(`  ${user.discordId}  warned since ${user.inactiveSince.slice(0, 10)}`);
  }
  console.log(`\n  reminder cohort: ${String(result.reminderCohortSize)} users`);

  if (result.breakerWarning) {
    console.log(
      chalk.yellow(
        '\n⚠️  Breaker warning: the cohort exceeds the warn share of the userbase. On the FIRST ' +
          'real run this is expected (the backfilled zombie cohort); on later runs, confirm real ' +
          'churn before proceeding. (The breaker is computed on the warning cohort only.)'
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
        `\nEnqueued ${String(result.batchesEnqueued)} warning batch(es) and ` +
          `${String(result.reminderBatchesEnqueued)} reminder batch(es). DMs go out at 1/sec via ` +
          'bot-client; delivery tallies arrive in the owner channel as batches complete.'
      )
    );
  }
}

/**
 * Run the real (non-dry) notify call under the run lease. Taken AFTER the
 * confirmation — an operator pondering the prompt must not hold it — and
 * released in a finally on normal completion and on a thrown error; an
 * interrupt during the single enqueue call exits without releasing, left to
 * the lease's TTL. Returns null when the lease could not be taken;
 * `beginRunLease` has already reported why and set the failing exit code.
 */
async function runLeasedNotify(
  client: ServiceClient,
  env: Environment,
  breakerOverride: boolean
): Promise<Awaited<ReturnType<ServiceClient['retentionNotify']>> | null> {
  const runContext = `ops retention:notify (${env})`;
  const runId = await beginRunLease(client, runContext);
  if (runId === null) {
    return null;
  }
  try {
    return await client.retentionNotify({ breakerOverride, runContext, runId });
  } finally {
    await releaseRunLease(client, runId);
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
          "dev mirrors prod's users via sync: this run DMs REAL users a deletion warning\n" +
            'or reminder from the dev bot, starting or restating their 30-day grace clocks.'
        )
      );
    }
    await requireProductionConfirmation(
      `DM a deletion warning to ${String(previewResult.data.cohortSize)} inactive users ` +
        '(starts their 30-day grace clocks) and a reminder to ' +
        `${String(previewResult.data.reminderCohortSize)} already-warned users` +
        (env === 'dev' ? ' via DEV, reaching the mirrored prod userbase' : '')
    );
  }

  const runResult = await runLeasedNotify(client, env, breakerOverride);
  if (runResult === null) {
    return;
  }
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
