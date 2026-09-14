/**
 * Operator-facing output and refusal helpers shared by the three stages of
 * `secrets:rotate-env`, kept out of `rotate-env-stages.ts` to stay under the
 * 400-line limit.
 */

import chalk from 'chalk';

import { UsageError } from '../utils/errors.js';
import type { checkDeployedCodeAcceptsPrevious } from './deployed-code-gate.js';

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
