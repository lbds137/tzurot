/**
 * Operator-facing output and refusal helpers shared by the three stages of
 * `secrets:rotate-env`, kept out of `rotate-env-stages.ts` to stay under the
 * 400-line limit.
 */

import chalk from 'chalk';

import { UsageError } from '../utils/errors.js';
import type { checkDeployedCodeAcceptsPrevious } from './deployed-code-gate.js';
import {
  composeRedeployRepair,
  partitionRedeployFailures,
  type RedeployFailure,
} from './redeploy-repair-text.js';

const DRY_RUN_NOTICE = '\n[DRY RUN] No changes made.';

export function printDryRunNotice(): void {
  console.log(chalk.green(DRY_RUN_NOTICE));
}

/**
 * Shared refusal for stage 2 and stage 3, which both require an OPEN window
 * (`windowOpen === false` is the failure). Returns `true` when the caller
 * should return immediately (the dry-run arm); throws on a real run.
 */
export function refuseIfWindowClosed(
  windowOpen: boolean,
  dryRun: boolean,
  previousName: string
): boolean {
  if (windowOpen) {
    return false;
  }
  const summary = `No rotation window is open ("${previousName}" is not set)`;
  if (dryRun) {
    console.log(chalk.red(`\n⚠️  ${summary}. A real run would REFUSE.`));
    printDryRunNotice();
    return true;
  }
  throw new UsageError(`${summary} — run stage 1 first.`);
}

/**
 * The next-step clause for a failed stage-1 verifier redeploy. The printed
 * report (as its `closing`) and the thrown Error share it, so the two cannot
 * name different next steps.
 */
export function stage1NextStep(verifierName: string): string {
  return (
    `Do NOT re-run stage 1 — run stage 2 only once "${verifierName}" shows SUCCESS ` +
    `in Railway (stage 2 redeploys "${verifierName}" and waits for SUCCESS, but its ` +
    `preflight refuses a FAILED, CRASHED, REMOVED or SKIPPED latest deployment); otherwise ` +
    `fix "${verifierName}" in the Railway dashboard until its latest deployment is SUCCESS ` +
    `first (\`pnpm ops deploy:redeploy\` refuses it too).`
  );
}

/** The next-step clause for failed stage-2 presenter redeploys; shared like {@link stage1NextStep}. */
export const STAGE2_NEXT_STEP =
  'Re-run stage 2 once every lagging service shows SUCCESS (its preflight refuses until every ' +
  'service does); a service whose latest deployment ended FAILED, CRASHED, REMOVED or ' +
  'SKIPPED must be fixed in the Railway dashboard until its latest deployment is SUCCESS ' +
  'first (`pnpm ops deploy:redeploy` refuses it too).';

/** The Error stage 1 throws after reporting a failed verifier redeploy. */
export function stage1RedeployFailureError(verifierName: string): Error {
  return new Error(
    `secrets:rotate-env stage 1: the values were written successfully, but the verifier failed ` +
      `to redeploy. ${stage1NextStep(verifierName)}`
  );
}

/** The Error stage 2 throws after reporting failed presenter redeploys. */
export function stage2RedeployFailureError(failureCount: number): Error {
  return new Error(
    `secrets:rotate-env stage 2: ${failureCount} service(s) failed to redeploy. ${STAGE2_NEXT_STEP}`
  );
}

/**
 * The next-step clause for a failed stage-3 verifier redeploy. A refused
 * redeploy goes to the dashboard first (the delete may have triggered a
 * deployment that is still in flight); a plain failure keeps the by-hand
 * wording. Both end with the ledger-stamp command. The printed report (as its
 * `closing`) and the thrown Error share it, so the two cannot name different
 * next steps.
 */
export function stage3NextStep(args: {
  verifierName: string;
  failures: RedeployFailure[];
  ledgerName: string;
  env: 'dev' | 'prod';
}): string {
  const { verifierName, failures, ledgerName, env } = args;
  const { refusedRepair, commands } = partitionRedeployFailures(failures, env);
  const repair = composeRedeployRepair(
    refusedRepair,
    commands,
    `redeploy "${verifierName}" by hand (Railway dashboard or ${commands}) and wait for it to reach SUCCESS`
  );
  return (
    `Do NOT re-run this command — ${repair}, then stamp the ledger with ` +
    `\`pnpm ops secrets:mark-rotated ${ledgerName} --env ${env}\`.`
  );
}

/** The Error stage 3 throws after reporting a failed verifier redeploy. */
export function stage3RedeployFailureError(args: {
  previousName: string;
  verifierName: string;
  failures: RedeployFailure[];
  ledgerName: string;
  env: 'dev' | 'prod';
}): Error {
  return new Error(
    `secrets:rotate-env stage 3: "${args.previousName}" was deleted from Railway, but "${args.verifierName}" ` +
      'failed to redeploy, so it may still accept the retired value in memory until it restarts. ' +
      stage3NextStep(args)
  );
}

export function printGateVerdict(
  result: Awaited<ReturnType<typeof checkDeployedCodeAcceptsPrevious>>
): void {
  if (result.ok) {
    console.log(
      chalk.dim(
        `  Deploy gate: PASS — the verifier is running ${result.commit}, which carries the ` +
          '"_PREVIOUS" acceptance.'
      )
    );
  } else {
    console.log(chalk.red(`  Deploy gate: REFUSE — ${result.reason}`));
  }
}
