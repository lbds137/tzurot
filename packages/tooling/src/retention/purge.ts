/**
 * `pnpm ops retention:purge` — erase the purge-eligible cohort, one account at
 * a time (Retention Phase 2, D2/D5).
 *
 * This is the epic's only destructive command. Its safeguards, in the order a
 * run hits them:
 *
 *   1. `--dry-run` short-circuits to the read-only preview.
 *   2. On prod, `requireProductionConfirmation` is the manual-approval gate that
 *      D5 requires — `--force` skips the PROMPT only.
 *   3. The gateway refuses each call when the cohort exceeds the hard-ceiling
 *      share of the userbase; `--breaker-override` is the deliberate,
 *      separate flag that bypasses it. `--force` cannot.
 *   4. Each per-user call re-checks eligibility inside its own transaction, so
 *      a user who became active since the preview is skipped, not erased.
 *
 * **Resuming is re-running.** Every purge removes its user from the cohort, so
 * an interrupted run picks up exactly where it stopped on the next invocation —
 * no local progress file, and therefore no stale-progress failure mode.
 */

import chalk from 'chalk';
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

export interface RetentionPurgeOptions {
  env: Environment;
  /** Report the cohort and stop — identical to `retention:preview` (D5). */
  dryRun?: boolean;
  /** Skip the production confirmation prompt. Does NOT bypass the breaker. */
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
  console.log(`  skipped:  ${String(tally.skipped)} (already gone, or active again)`);
  if (tally.excluded > 0) {
    console.log(`  excluded: ${String(tally.excluded)} (--exclude)`);
  }
  if (tally.failed > 0) {
    console.log(chalk.red(`  failed:   ${String(tally.failed)} — re-run to retry`));
  }
}

/**
 * Ask for approval on prod. Returns only when the run may proceed — a
 * decline exits inside the gate.
 *
 * Note the asymmetry with the breaker: this gate is about the OPERATOR being
 * present, which `--force` legitimately asserts in a scripted context. The
 * breaker is about the DATA being plausible, which no amount of operator
 * intent can vouch for — hence a separate flag, checked server-side.
 */
async function approveOnProd(
  env: Environment,
  force: boolean,
  eligibleCount: number
): Promise<void> {
  if (env !== 'prod' || force) {
    return;
  }
  await requireProductionConfirmation(
    `permanently erase ${String(eligibleCount)} inactive, unreachable accounts`
  );
}

/** The gateway calls this loop needs — narrowed so tests can supply a stub. */
interface PurgeClient {
  retentionPurge: (input: {
    discordId: string;
    runContext: string;
    breakerOverride: boolean;
  }) => Promise<
    { ok: true; data: RetentionPurgeResponse } | { ok: false; kind: string; error: string }
  >;
}

interface PurgeLoopOptions {
  excludes: Set<string>;
  runContext: string;
  breakerOverride: boolean;
}

/**
 * Purge each cohort member in turn, returning the run tally.
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
): Promise<PurgeRunTally> {
  const { excludes, runContext, breakerOverride } = options;
  const tally = newTally();

  // Report what has happened so far if the operator interrupts mid-cohort — the
  // per-user purges that already committed are real and worth reporting.
  const onInterrupt = (): void => {
    console.log(chalk.yellow('\n\nInterrupted — re-run to resume where this stopped.'));
    renderTally(tally);
    process.exit(130);
  };
  process.on('SIGINT', onInterrupt);

  try {
    for (const user of users) {
      if (excludes.has(user.discordId)) {
        tally.excluded += 1;
        console.log(chalk.dim(`  ${user.discordId}  excluded`));
        continue;
      }

      const result = await client.retentionPurge({
        discordId: user.discordId,
        runContext,
        breakerOverride,
      });

      if (!result.ok) {
        tally.failed += 1;
        console.error(chalk.red(`  ${user.discordId}  FAILED (${result.kind}): ${result.error}`));
        continue;
      }
      if (result.data.status === 'skipped') {
        tally.skipped += 1;
        console.log(chalk.yellow(`  ${user.discordId}  skipped — ${result.data.reason ?? ''}`));
        if (result.data.reason === 'breaker_tripped') {
          // Every subsequent call would trip identically; stop rather than
          // printing the same refusal once per cohort member.
          console.error(chalk.red(`\n${result.data.detail ?? 'Circuit breaker tripped.'}`));
          break;
        }
        continue;
      }

      tally.purged += 1;
      tally.charactersDeleted += result.data.charactersDeleted ?? 0;
      tally.charactersReHomed += result.data.charactersReHomed ?? 0;
      console.log(chalk.green(`  ${user.discordId}  purged`));
    }
  } finally {
    process.off('SIGINT', onInterrupt);
  }

  return tally;
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
  await approveOnProd(env, force, preview.totals.eligibleCount);

  const tally = await purgeCohort(client, preview.users, {
    excludes: parseExcludes(options.exclude),
    runContext: `ops retention:purge (${env})`,
    breakerOverride,
  });

  // Drain any off-DB cleanup this run (or an earlier one) left owed. Cheap and
  // idempotent when there is nothing to do, so it runs unconditionally.
  const reconciled = await client.retentionReconcileOffDb();
  if (reconciled.ok && reconciled.data.settled + reconciled.data.stillFailing > 0) {
    console.log(
      chalk.dim(
        `\nOff-DB reconciliation: ${String(reconciled.data.settled)} settled, ` +
          `${String(reconciled.data.stillFailing)} still failing.`
      )
    );
  }

  renderTally(tally);
}
