/**
 * `pnpm ops retention:purge` — erase the purge-eligible cohort, one account at
 * a time (Retention Phase 2, D2/D5).
 *
 * This is the epic's only destructive command. Its safeguards, in the order a
 * run hits them:
 *
 *   1. `--dry-run` short-circuits to the read-only preview.
 *   2. In EVERY environment, `requireProductionConfirmation` is the
 *      manual-approval gate that D5 requires — `--force` skips the PROMPT
 *      only. Dev is not exempt: `users` is sync-tracked, so a dev purge's
 *      tombstones erase the same accounts from prod on the next sync.
 *   3. The gateway refuses each call when the cohort exceeds the hard-ceiling
 *      share of the userbase; `--breaker-override` is the deliberate,
 *      separate flag that bypasses it. `--force` cannot.
 *   4. Each per-user call re-checks eligibility inside its own transaction, so
 *      a user who became active since the preview is skipped, not erased.
 *   5. The run lease — taken (via `run/begin`) AFTER the preview and the
 *      operator's confirmation, so a pondering operator never holds it,
 *      refreshed before every per-user call, and released on every exit path
 *      (normal completion, interruption, or a thrown error). A second
 *      concurrent run is refused, naming the holder; a lease lost mid-run
 *      stops the loop rather than continuing to purge without exclusivity.
 *   6. The gateway's purge scope (see the gateway's `purgeScope.ts`): a
 *      non-production gateway purges only accounts on its own
 *      OUTBOUND_DM_ALLOWLIST, and refuses every purge when that allowlist is
 *      unset — it never falls open to an unscoped cohort.
 *
 * **Resuming is re-running.** Every purge removes its user from the cohort, so
 * an interrupted run picks up exactly where it stopped on the next invocation —
 * no local progress file, and therefore no stale-progress failure mode.
 */

import chalk from 'chalk';
import type { ServiceClient } from '@tzurot/clients';
import type {
  RetentionPreviewResponse,
  RetentionPurgeResponse,
} from '@tzurot/common-types/schemas/api/internal';
import {
  type Environment,
  validateEnvironment,
  showEnvironmentBanner,
  requireProductionConfirmation,
} from '../utils/env-runner.js';
import { resolveServiceClientOrExit } from '../utils/gateway-client.js';
import { renderPreview } from './preview.js';
import { beginRunLease, releaseRunLease, isRunLeaseLost, type RunLeaseClient } from './runLease.js';

export interface RetentionPurgeOptions {
  env: Environment;
  /** Report the cohort and stop — identical to `retention:preview` (D5). */
  dryRun?: boolean;
  /** Skip the confirmation prompt (every env prompts). Does NOT bypass the breaker. */
  force?: boolean;
  /** Comma-separated Discord IDs to skip for this run only. */
  exclude?: string;
  /** Proceed despite the hard-ceiling breaker. Deliberately not `--force`. */
  breakerOverride?: boolean;
}

/** Tally of one run, printed on completion AND on interruption. */
export interface PurgeRunTally {
  purged: number;
  skipped: number;
  excluded: number;
  charactersDeleted: number;
  charactersReHomed: number;
  failed: number;
}

export function newTally(): PurgeRunTally {
  return {
    purged: 0,
    skipped: 0,
    excluded: 0,
    charactersDeleted: 0,
    charactersReHomed: 0,
    failed: 0,
  };
}

/** Parse `--exclude a,b,c` into a set. Exported for testing. */
export function parseExcludes(raw: string | undefined): Set<string> {
  if (raw === undefined || raw.trim() === '') {
    return new Set();
  }
  return new Set(
    raw
      .split(',')
      .map(id => id.trim())
      .filter(id => id !== '')
  );
}

/** Print the run tally. Exported so the interrupt handler can reuse it. */
export function renderTally(tally: PurgeRunTally): void {
  console.log(chalk.bold('\nRun summary:'));
  console.log(`  purged:   ${String(tally.purged)}`);
  console.log(
    `  characters: ${String(tally.charactersDeleted)} deleted, ` +
      `${String(tally.charactersReHomed)} re-homed to the Orphaned Characters bucket`
  );
  console.log(`  skipped:  ${String(tally.skipped)} (see the per-account reasons above)`);
  if (tally.excluded > 0) {
    console.log(`  excluded: ${String(tally.excluded)} (--exclude)`);
  }
  if (tally.failed > 0) {
    console.log(chalk.red(`  failed:   ${String(tally.failed)} — re-run to retry`));
  }
}

/** Human text for each skip reason the gateway can report. */
const SKIP_REASON_TEXT: Record<NonNullable<RetentionPurgeResponse['reason']>, string> = {
  already_gone: 'already gone',
  no_longer_eligible: 'active again since the preview',
  breaker_tripped: 'circuit breaker tripped',
  outside_allowlist: "outside this environment's OUTBOUND_DM_ALLOWLIST",
  unscoped_non_production: 'refused: non-production gateway with no OUTBOUND_DM_ALLOWLIST',
};

/**
 * True for a skip reason where every SUBSEQUENT call in this run would refuse
 * identically — the loop stops rather than reprinting the same refusal once
 * per remaining cohort member. `outside_allowlist` is deliberately NOT here:
 * it is per-TARGET, not per-run — a later cohort member can still be inside
 * the allowlist.
 *
 * `unscoped_non_production` is defense-in-depth here: the preview this loop
 * iterates (`preview.users`) is itself built from the gateway's scope-narrowed
 * cohort, so THIS command's own loop reaches this branch only if the
 * gateway's scope changes between the preview call and a purge call in the
 * same run. It also covers any other caller of the purge endpoint that
 * supplies targets not drawn from that preview.
 */
function isTerminalSkip(reason: RetentionPurgeResponse['reason']): boolean {
  return reason === 'breaker_tripped' || reason === 'unscoped_non_production';
}

/** The operator-facing detail line for a terminal skip. */
function terminalSkipDetail(data: RetentionPurgeResponse): string {
  if (data.reason === 'unscoped_non_production') {
    return (
      'This gateway is not production and has no OUTBOUND_DM_ALLOWLIST, so it refuses ' +
      'every purge. Set the allowlist on this environment to purge its own accounts.'
    );
  }
  return data.detail ?? 'Circuit breaker tripped.';
}

/**
 * Ask for approval in EVERY environment. Returns only when the run may
 * proceed — a decline exits inside the gate.
 *
 * Dev is gated too, and not as belt-and-braces: `users` is a sync-tracked
 * table, and a purge writes `sync_tombstones` rows precisely so a later sync
 * cannot resurrect the account. A dev-side purge therefore deletes the same
 * people from PROD on the next sync — the one destructive command in this
 * epic has no sandbox environment, so it gets no unprompted environment.
 *
 * Note the asymmetry with the breaker: this gate is about the OPERATOR being
 * present, which `--force` legitimately asserts in a scripted context. The
 * breaker is about the DATA being plausible, which no amount of operator
 * intent can vouch for — hence a separate flag, checked server-side.
 */
async function approveDestructivePurge(
  env: Environment,
  force: boolean,
  eligibleCount: number
): Promise<void> {
  if (force) {
    return;
  }
  if (env === 'dev') {
    // The shared gate's banner names PRODUCTION unconditionally; on a dev run
    // that is only half the story, so the sync consequence is spelled out
    // here before the prompt renders. DEV ONLY: `local` is not part of the
    // dev<->prod sync, so it gets the plain prompt — asserting a sync
    // consequence there would train the operator to discount this banner.
    console.log(chalk.red.bold('\n⚠️  A DEV PURGE IS NOT A SANDBOX OPERATION'));
    console.log(
      chalk.red(
        "dev's users table is dev<->prod sync-tracked: purge deletions write tombstones\n" +
          'that propagate to PROD on the next sync. The dev gateway only purges accounts\n' +
          'on its own OUTBOUND_DM_ALLOWLIST, and those accounts are erased from production\n' +
          'too via the sync — the tombstone exists so a later sync cannot bring them back.'
      )
    );
  }
  await requireProductionConfirmation(
    `permanently erase ${String(eligibleCount)} inactive, unreachable accounts` +
      (env === 'dev' ? ' via DEV, propagating by sync' : '')
  );
}

/** The gateway calls this loop needs — narrowed so tests can supply a stub. */
interface PurgeClient extends RunLeaseClient {
  retentionPurge: (input: {
    discordId: string;
    runContext: string;
    breakerOverride: boolean;
    runId: string;
  }) => Promise<
    | { ok: true; data: RetentionPurgeResponse }
    | { ok: false; kind: string; error: string; code?: string }
  >;
}

interface PurgeLoopOptions {
  excludes: Set<string>;
  runContext: string;
  breakerOverride: boolean;
  runId: string;
}

/** Whether the cohort loop should keep going after one member's outcome. */
type MemberOutcome = 'continue' | 'stop';

/**
 * Process ONE cohort member (exclude / purge / report), mutating `tally` in
 * place and returning whether the loop should stop. Extracted from
 * `purgeCohort` to keep that function's own branching shallow — this is
 * where all of it lives.
 */
async function processCohortMember(
  client: PurgeClient,
  user: RetentionPreviewResponse['users'][number],
  tally: PurgeRunTally,
  options: PurgeLoopOptions
): Promise<MemberOutcome> {
  const { excludes, runContext, breakerOverride, runId } = options;
  if (excludes.has(user.discordId)) {
    tally.excluded += 1;
    console.log(chalk.dim(`  ${user.discordId}  excluded`));
    return 'continue';
  }

  const result = await client.retentionPurge({
    discordId: user.discordId,
    runContext,
    breakerOverride,
    runId,
  });

  if (!result.ok) {
    if (isRunLeaseLost(result)) {
      console.error(chalk.red(`\n${result.error}`));
      console.error(
        chalk.red('Stopping: this run lost the retention run lease. Nothing further was purged.')
      );
      process.exitCode = 1;
      return 'stop';
    }
    tally.failed += 1;
    console.error(chalk.red(`  ${user.discordId}  FAILED (${result.kind}): ${result.error}`));
    return 'continue';
  }
  if (result.data.status === 'skipped') {
    tally.skipped += 1;
    const reasonText =
      result.data.reason !== undefined
        ? (SKIP_REASON_TEXT[result.data.reason] ?? result.data.reason)
        : 'no reason given';
    console.log(chalk.yellow(`  ${user.discordId}  skipped — ${reasonText}`));
    if (isTerminalSkip(result.data.reason)) {
      console.error(chalk.red(`\n${terminalSkipDetail(result.data)}`));
      return 'stop';
    }
    return 'continue';
  }

  tally.purged += 1;
  tally.charactersDeleted += result.data.charactersDeleted ?? 0;
  tally.charactersReHomed += result.data.charactersReHomed ?? 0;
  console.log(chalk.green(`  ${user.discordId}  purged`));
  return 'continue';
}

/**
 * Purge each cohort member in turn, returning the run tally and whether the
 * run was interrupted (Ctrl-C).
 *
 * Sequential on purpose: these are 60-second erasure transactions, and running
 * them concurrently would multiply the blast radius of a mistake while making
 * the interrupt point ambiguous. Every per-user outcome is reported as it
 * happens, so an interrupted run has already told the operator where it got to.
 */
async function purgeCohort(
  client: PurgeClient,
  users: RetentionPreviewResponse['users'],
  options: PurgeLoopOptions
): Promise<{ tally: PurgeRunTally; interrupted: boolean }> {
  const tally = newTally();
  let interrupted = false;

  const onInterrupt = (): void => {
    if (interrupted) {
      // A second Ctrl-C: the operator does not want to wait on the release.
      process.exit(130);
      return;
    }
    interrupted = true;
    console.log(chalk.yellow('\n\nInterrupted — re-run to resume where this stopped.'));
    renderTally(tally);
    // Best-effort release so the next run need not wait out the lease TTL —
    // releaseRunLease itself swallows any failure.
    void releaseRunLease(client, options.runId).finally(() => process.exit(130));
  };
  process.on('SIGINT', onInterrupt);

  try {
    for (const user of users) {
      if (interrupted) {
        // No purge call is issued after an interrupt.
        break;
      }
      const outcome = await processCohortMember(client, user, tally, options);
      if (outcome === 'stop') {
        break;
      }
    }
  } finally {
    process.off('SIGINT', onInterrupt);
  }

  return { tally, interrupted };
}

/**
 * Drain any off-DB cleanup this run (or an earlier one) left owed, and report
 * it. Cheap and idempotent when there is nothing to do, so it runs
 * unconditionally after every completed (non-interrupted) run.
 */
async function reconcileAndReport(client: ServiceClient): Promise<void> {
  const reconciled = await client.retentionReconcileOffDb();
  if (reconciled.ok && reconciled.data.settled + reconciled.data.stillFailing > 0) {
    console.log(
      chalk.dim(
        `\nOff-DB reconciliation: ${String(reconciled.data.settled)} settled, ` +
          `${String(reconciled.data.stillFailing)} still failing.`
      )
    );
  }
  // The endpoint sweeps one bounded batch; a backlog beyond it self-heals on
  // the next run, but say so instead of silently under-reporting the queue.
  if (reconciled.ok && reconciled.data.remaining > 0) {
    console.log(
      chalk.yellow(
        `  off-DB rows not attempted: ${String(reconciled.data.remaining)} — ` +
          'run retention:reconcile-off-db to drain the rest.'
      )
    );
  }
}

/** Entry point for `pnpm ops retention:purge`. */
export async function retentionPurge(options: RetentionPurgeOptions): Promise<void> {
  const { env, dryRun = false, force = false, breakerOverride = false } = options;
  validateEnvironment(env);
  showEnvironmentBanner(env);

  const client = resolveServiceClientOrExit(env);
  if (client === null) {
    return;
  }

  const previewResult = await client.retentionPreview();
  if (!previewResult.ok) {
    console.error(
      chalk.red(
        `\nFailed to fetch the retention preview (${previewResult.kind}): ${previewResult.error}`
      )
    );
    process.exitCode = 1;
    return;
  }
  const preview: RetentionPreviewResponse = previewResult.data;
  renderPreview(preview);

  if (dryRun) {
    console.log(chalk.yellow('\nDry run — nothing was purged.'));
    return;
  }
  if (preview.users.length === 0) {
    return;
  }
  await approveDestructivePurge(env, force, preview.totals.eligibleCount);

  // The lease is taken AFTER the preview and the confirmation — an operator
  // pondering the prompt must not hold it — and released on every exit path.
  const runContext = `ops retention:purge (${env})`;
  const runId = await beginRunLease(client, runContext);
  if (runId === null) {
    return;
  }

  // Declared before the try, default false: a purgeCohort that THROWS never
  // touches this, so the finally below still releases normally. Only the
  // interrupted-return path sets it — that path's SIGINT handler has already
  // released the lease itself (see onInterrupt), so the finally must not
  // release it a second time.
  let runWasInterrupted = false;
  try {
    const { tally, interrupted } = await purgeCohort(client, preview.users, {
      excludes: parseExcludes(options.exclude),
      runContext,
      breakerOverride,
      runId,
    });
    runWasInterrupted = interrupted;
    if (interrupted) {
      return;
    }
    await reconcileAndReport(client);
    renderTally(tally);
  } finally {
    if (!runWasInterrupted) {
      await releaseRunLease(client, runId);
    }
  }
}
