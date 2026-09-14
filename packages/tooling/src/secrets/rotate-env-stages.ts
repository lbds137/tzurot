/**
 * The staged, three-stage rotation for a shared Railway secret whose verifier
 * dual-accepts `<NAME>_PREVIOUS`.
 *
 * Stage 1 (`1|stage`) preserves the current value as `<NAME>_PREVIOUS`, mints
 * a new primary, and redeploys ONLY the verifier — the presenters (bot-client,
 * ai-worker, …) are deliberately NOT redeployed here, because they still hold
 * the outgoing value and the restarted verifier now accepts it as
 * `<NAME>_PREVIOUS`. Given the verifier's redeploy from a stage completes
 * before the next stage runs, there is no 401 window: every presenter's held
 * value matches one of the two the verifier accepts, both before and after
 * stage 1 — which is why each stage's output ends by naming what to wait for
 * before continuing.
 *
 * Stage 2 (`2|roll`) redeploys every OTHER inheriting service onto the new
 * primary. No variable is written at this stage.
 *
 * Stage 3 (`3|finalize`) deletes `<NAME>_PREVIOUS`, redeploys the verifier
 * once more (so it stops accepting the retired value), and stamps the
 * rotation ledger — only stage 3 stamps it, since an abandoned stage 1 must
 * not read as a completed rotation.
 */

import crypto from 'node:crypto';
import chalk from 'chalk';

import {
  upsertRailwayVariable,
  deleteRailwayVariable,
  readRailwayVariableValue,
} from '../deployment/railway-api.js';
import { confirmPrompt } from '../utils/confirm.js';
import { UsageError } from '../utils/errors.js';
import { checkDeployedCodeAcceptsPrevious } from './deployed-code-gate.js';
import {
  redeployServices,
  reportRedeployFailures,
  stampLedger,
  type RotationContext,
} from './rotate-env-context.js';

/**
 * Names whose VERIFIER service accepts `<NAME>_PREVIOUS` alongside the current
 * value. Only these can be rotated through the staged flow: staging a name
 * nothing dual-accepts would open a window nothing closes.
 */
const DUAL_ACCEPTANCE: Record<string, { verifierService: string }> = {
  INTERNAL_SERVICE_SECRET: { verifierService: 'api-gateway' },
};

/** `Object.hasOwn` so an inherited prototype key (`toString`, …) never reads as registered. */
export function getDualAcceptance(name: string): { verifierService: string } | undefined {
  return Object.hasOwn(DUAL_ACCEPTANCE, name) ? DUAL_ACCEPTANCE[name] : undefined;
}

const STAGE_ALIASES: Record<string, 1 | 2 | 3> = {
  '1': 1,
  stage: 1,
  '2': 2,
  roll: 2,
  '3': 3,
  finalize: 3,
};

/**
 * Resolve a `--stage` value to its stage number, or `undefined` for anything
 * unrecognized. `Object.hasOwn` is load-bearing, not defensive filler: a bare
 * index (`STAGE_ALIASES[rawStage]`) resolves an inherited key (`constructor`,
 * `toString`, `__proto__`) to a non-undefined value and would fall through to
 * stage 3, the destructive stage. Exported so callers can resolve the stage
 * BEFORE any IO — an invalid value is then a usage error with no network
 * traffic, rather than surfacing after a Railway round trip.
 */
export function resolveStageAlias(rawStage: string): 1 | 2 | 3 | undefined {
  const trimmed = rawStage.trim();
  return Object.hasOwn(STAGE_ALIASES, trimmed) ? STAGE_ALIASES[trimmed] : undefined;
}

export interface StagedRotationOptions {
  env: 'dev' | 'prod';
  name: string;
  stage: string;
  dryRun: boolean;
  yes: boolean;
  verifierService: string;
}

interface StageArgs {
  options: StagedRotationOptions;
  context: RotationContext;
  verifier: { id: string; name: string };
  previousName: string;
  windowOpen: boolean;
}

const DRY_RUN_NOTICE = '\n[DRY RUN] No changes made.';

function printDryRunNotice(): void {
  console.log(chalk.green(DRY_RUN_NOTICE));
}

/**
 * Shared refusal for stage 2 and stage 3, which both require an OPEN window
 * (`windowOpen === false` is the failure). Returns `true` when the caller
 * should return immediately (the dry-run arm); throws on a real run.
 */
function refuseIfWindowClosed(windowOpen: boolean, dryRun: boolean, previousName: string): boolean {
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
 * Read the primary and `_PREVIOUS` values and report whether they are EQUAL —
 * the signature of a stage 1 that upserted `_PREVIOUS` but died before
 * minting a fresh primary (a half-completed run, not a real rotation
 * window). Shared by stage 1 (to resume a half-completed run instead of
 * refusing) and stage 3 (to refuse to stamp a rotation that never happened).
 *
 * Both reads are of SECRET VALUES: compared and discarded here, never
 * printed, logged, or included in a thrown error.
 */
async function isDegenerateWindow(args: {
  context: RotationContext;
  options: StagedRotationOptions;
  previousName: string;
}): Promise<boolean> {
  const { context, options, previousName } = args;
  const [primaryValue, previousValue] = await Promise.all([
    readRailwayVariableValue({
      projectId: context.projectId,
      environmentId: context.environmentId,
      name: options.name,
      env: options.env,
    }),
    readRailwayVariableValue({
      projectId: context.projectId,
      environmentId: context.environmentId,
      name: previousName,
      env: options.env,
    }),
  ]);
  return primaryValue === previousValue;
}

function printGateVerdict(
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

async function runStage1(args: StageArgs): Promise<void> {
  const { options, context, verifier, previousName, windowOpen } = args;

  const gateResult = await checkDeployedCodeAcceptsPrevious({
    environmentId: context.environmentId,
    serviceId: verifier.id,
    serviceName: verifier.name,
    name: options.name,
    env: options.env,
  });
  printGateVerdict(gateResult);

  if (windowOpen) {
    // A degenerate window (`_PREVIOUS` already equal to the current primary) is a
    // half-completed stage 1 — its second upsert (minting the fresh primary) never
    // landed — not a real rotation in progress. Resume it instead of refusing.
    const degenerate = await isDegenerateWindow({ context, options, previousName });
    if (!degenerate) {
      if (options.dryRun) {
        console.log(
          chalk.red(
            `\n⚠️  A rotation window is already open ("${previousName}" is set). A real run would ` +
              'REFUSE — run stage 2 (roll) then stage 3 (finalize) to close it before starting a new ' +
              `rotation. First confirm in the Railway dashboard that "${verifier.name}"'s redeploy ` +
              'actually landed: an interrupted stage 1 can leave these values written with the ' +
              'verifier never redeployed, and stage 2 in that state opens the window.'
          )
        );
        printDryRunNotice();
        return;
      }
      throw new UsageError(
        `A rotation window is already open ("${previousName}" is set) — run stage 2 (roll) then ` +
          'stage 3 (finalize) to close it before starting a new rotation. Demoting the current ' +
          `value now would strand the original. First confirm in the Railway dashboard that ` +
          `"${verifier.name}"'s redeploy actually landed: an interrupted stage 1 can leave these ` +
          'values written with the verifier never redeployed, and stage 2 in that state opens the window.'
      );
    }
    console.log(
      chalk.yellow(
        `\n⚠️  Detected a half-completed stage 1 ("${previousName}" already matches the current ` +
          'primary) — resuming it instead of refusing.'
      )
    );
  }

  if (options.dryRun) {
    if (!gateResult.ok) {
      console.log(chalk.red(`\n⚠️  A real run would REFUSE stage 1: ${gateResult.reason}`));
      printDryRunNotice();
      return;
    }
    console.log(
      chalk.dim(`  Plan: preserve current value as "${previousName}", mint a new primary`)
    );
    console.log(chalk.dim(`  Plan: redeploy only "${verifier.name}"`));
    console.log(chalk.dim('  Plan: presenters are deliberately NOT redeployed at this stage'));
    printDryRunNotice();
    return;
  }

  if (!gateResult.ok) {
    throw new UsageError(`Deploy-ordering gate refused stage 1: ${gateResult.reason}`);
  }

  if (!options.yes) {
    const confirmed = await confirmPrompt(
      'This will preserve the current value, mint a new primary, and redeploy the verifier.'
    );
    if (!confirmed) {
      console.log('Aborted.');
      return;
    }
  }

  await writeStage1ValuesAndRedeploy(args);
}

/**
 * The write + redeploy half of stage 1, split out purely to keep `runStage1`
 * under the per-function line limit — same control flow, no behavior change.
 */
async function writeStage1ValuesAndRedeploy(args: StageArgs): Promise<void> {
  const { options, context, verifier, previousName } = args;

  const currentValue = await readRailwayVariableValue({
    projectId: context.projectId,
    environmentId: context.environmentId,
    name: options.name,
    env: options.env,
  });
  if (currentValue === undefined || currentValue.length === 0) {
    throw new Error(
      `"${options.name}" has no value at the shared tier in Railway ${context.railwayEnvName} — ` +
        `there is nothing to preserve as "${previousName}".`
    );
  }

  await upsertRailwayVariable({
    projectId: context.projectId,
    environmentId: context.environmentId,
    name: previousName,
    value: currentValue,
    skipDeploys: true,
    env: options.env,
  });
  await upsertRailwayVariable({
    projectId: context.projectId,
    environmentId: context.environmentId,
    name: options.name,
    value: crypto.randomBytes(32).toString('hex'),
    skipDeploys: true,
    env: options.env,
  });

  const failures = await redeployServices([verifier], {
    environmentId: context.environmentId,
    env: options.env,
  });

  if (failures.length > 0) {
    console.log(
      chalk.yellow(`\n⚠️  Stage 1 wrote the new values, but the verifier failed to redeploy`)
    );
  } else {
    console.log(
      chalk.green(`\n✓ Stage 1 complete for "${options.name}" in Railway ${context.railwayEnvName}`)
    );
  }
  console.log(
    chalk.dim(
      '  Not redeployed (deliberately): the other inheriting services — they keep presenting ' +
        `the outgoing value, which the restarted "${verifier.name}" now accepts as "${previousName}".`
    )
  );
  console.log(chalk.dim(`  Wait for "${verifier.name}"'s redeploy to finish, then run:`));
  console.log(
    chalk.dim(`  pnpm ops secrets:rotate-env --env ${options.env} --name ${options.name} --stage 2`)
  );

  if (failures.length > 0) {
    reportRedeployFailures(
      failures,
      `The new primary is live and "${previousName}" holds the old value; re-running stage 1 ` +
        'would refuse, because the window is now open.'
    );
    throw new Error(
      `secrets:rotate-env stage 1: the values were written successfully, but the verifier failed ` +
        `to redeploy. Do NOT re-run this command — redeploy "${verifier.name}" by hand.`
    );
  }
}

async function runStage2(args: StageArgs): Promise<void> {
  const { options, context, verifier, previousName, windowOpen } = args;

  if (refuseIfWindowClosed(windowOpen, options.dryRun, previousName)) {
    return;
  }

  const presenters = context.affectedServices.filter(svc => svc.id !== verifier.id);

  if (options.dryRun) {
    console.log(
      chalk.dim(`  Plan: redeploy ${presenters.map(svc => svc.name).join(', ') || '(none)'}`)
    );
    console.log(chalk.dim('  Plan: no variable writes'));
    printDryRunNotice();
    return;
  }

  if (!options.yes) {
    const confirmed = await confirmPrompt(
      'This will redeploy every presenter onto the new primary.'
    );
    if (!confirmed) {
      console.log('Aborted.');
      return;
    }
  }

  const failures = await redeployServices(presenters, {
    environmentId: context.environmentId,
    env: options.env,
  });

  if (failures.length > 0) {
    console.log(chalk.yellow(`\n⚠️  Stage 2: ${failures.length} presenter(s) failed to redeploy`));
  } else {
    console.log(
      chalk.green(`\n✓ Stage 2 complete for "${options.name}" in Railway ${context.railwayEnvName}`)
    );
  }
  console.log(
    chalk.dim(
      '  Next: pnpm ops secrets:rotate-env ' +
        `--env ${options.env} --name ${options.name} --stage 3`
    )
  );

  if (failures.length > 0) {
    reportRedeployFailures(failures, 'Nothing was written — stage 2 only redeploys presenters.');
    throw new Error(
      `secrets:rotate-env stage 2: ${failures.length} service(s) failed to redeploy. Do NOT ` +
        're-run this command — redeploy the lagging service(s) by hand.'
    );
  }
}

async function runStage3(args: StageArgs): Promise<void> {
  const { options, context, verifier, previousName, windowOpen } = args;

  if (refuseIfWindowClosed(windowOpen, options.dryRun, previousName)) {
    return;
  }

  // A degenerate window here means the primary was NEVER rotated — only stage 1's
  // first upsert (preserving `_PREVIOUS`) landed, never its second (minting a fresh
  // primary). Closing the window in that state would stamp the ledger for a
  // rotation that did not happen, silently defeating the cadence guarantee. Checked
  // before the dry-run plan below so `--dry-run` reports what a real run would do.
  const degenerate = await isDegenerateWindow({ context, options, previousName });
  if (degenerate) {
    if (options.dryRun) {
      console.log(
        chalk.red(
          `\n⚠️  "${previousName}" still matches the current primary for "${options.name}" — the ` +
            'primary was never rotated. A real run would REFUSE to stamp the ledger for a ' +
            'rotation that did not happen — re-run stage 1 (it will now resume) instead.'
        )
      );
      printDryRunNotice();
      return;
    }
    throw new UsageError(
      `"${previousName}" still matches the current primary for "${options.name}" — the primary ` +
        'was never rotated, so closing the window here would stamp the ledger for a rotation ' +
        'that did not happen. Re-run stage 1 (it will now resume) instead.'
    );
  }

  if (options.dryRun) {
    console.log(chalk.dim(`  Plan: delete "${previousName}" at the shared tier`));
    console.log(chalk.dim(`  Plan: redeploy "${verifier.name}"`));
    console.log(chalk.dim('  Plan: stamp the ledger'));
    printDryRunNotice();
    return;
  }

  if (!options.yes) {
    const confirmed = await confirmPrompt(
      'This will close the rotation window and redeploy the verifier.'
    );
    if (!confirmed) {
      console.log('Aborted.');
      return;
    }
  }

  // Deleted, not upserted as ''. The BYOK precedent sets an empty string only
  // because the Railway CLI cannot delete a variable; this module calls the
  // API directly and can, so it does.
  //
  // Unlike the upsert calls above (both pass `skipDeploys: true`), Railway's
  // `VariableDeleteInput` carries no `skipDeploys` field at all — probed by
  // live GraphQL introspection, so there is nothing to pass here. Whether
  // Railway auto-redeploys the verifier on a variable delete is UNVERIFIED
  // for a referenced variable; if it does, the explicit redeploy below is a
  // second, redundant restart rather than a correctness problem, since both
  // deploys land on the same post-delete configuration.
  await deleteRailwayVariable({
    projectId: context.projectId,
    environmentId: context.environmentId,
    name: previousName,
    env: options.env,
  });

  const failures = await redeployServices([verifier], {
    environmentId: context.environmentId,
    env: options.env,
  });

  // Stamped only when the verifier's redeploy succeeded: `_PREVIOUS` is gone from
  // Railway's store either way, but a still-running verifier loaded its env at
  // process start and keeps accepting the retired value in memory until it
  // restarts — stamping here would record a completed rotation (and reset the
  // overdue-nag interval) while the acceptance window is still open in practice.
  const ledgerName = options.name.toLowerCase().replaceAll('_', '-');

  if (failures.length > 0) {
    reportRedeployFailures(
      failures,
      `"${previousName}" was deleted, so the retired value is gone from Railway's store, but the ` +
        'un-redeployed verifier may still accept it in memory.'
    );
    throw new Error(
      `secrets:rotate-env stage 3: "${previousName}" was deleted from Railway, but "${verifier.name}" ` +
        'failed to redeploy, so it may still accept the retired value in memory until it restarts. ' +
        `Do NOT re-run this command — redeploy "${verifier.name}" by hand, then stamp the ledger with ` +
        `\`pnpm ops secrets:mark-rotated ${ledgerName} --env ${options.env}\`.`
    );
  }

  const ledgerStamped = await stampLedger(options.env, ledgerName);

  console.log(
    chalk.green(`\n✓ Rotation of "${options.name}" complete in Railway ${context.railwayEnvName}`)
  );
  console.log(chalk.dim('  Window: closed'));
  console.log(
    chalk.dim(
      `  Ledger: ${ledgerStamped ? `${ledgerName} stamped` : 'NOT stamped — run the command above'}`
    )
  );
}

export async function runStagedRotation(
  options: StagedRotationOptions,
  context: RotationContext
): Promise<void> {
  // Re-validated here even though `runRotateEnvSecret` already resolves the
  // stage before calling in: this function is also called directly (see its
  // tests), so it cannot rely on a caller-side guard having already run.
  const stageNumber = resolveStageAlias(String(options.stage));
  if (stageNumber === undefined) {
    throw new UsageError(`Unknown stage "${options.stage}" — use 1|stage, 2|roll, or 3|finalize.`);
  }

  if (options.env === 'prod' && options.yes) {
    throw new UsageError(
      '--yes is refused on prod for secrets:rotate-env — a live secret rotation always gets a ' +
        'human at the keyboard, staged or not.'
    );
  }

  const verifier = context.affectedServices.find(svc => svc.name === options.verifierService);
  if (verifier === undefined) {
    const inheriting = context.affectedServices.map(svc => svc.name).join(', ') || '(none)';
    throw new UsageError(
      `"${options.name}" is not inherited by its verifier service "${options.verifierService}" in ` +
        `Railway ${context.railwayEnvName} — the dual-acceptance registry or the environment is ` +
        `wrong. Inheriting services: ${inheriting}.`
    );
  }

  const previousName = `${options.name}_PREVIOUS`;
  const windowOpen = context.sharedNames.includes(previousName);

  const stageArgs: StageArgs = { options, context, verifier, previousName, windowOpen };

  if (stageNumber === 1) {
    await runStage1(stageArgs);
    return;
  }
  if (stageNumber === 2) {
    await runStage2(stageArgs);
    return;
  }
  await runStage3(stageArgs);
}
