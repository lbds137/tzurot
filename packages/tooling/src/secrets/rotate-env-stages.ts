/**
 * The staged, three-stage rotation for a shared Railway secret whose verifier
 * dual-accepts `<NAME>_PREVIOUS`.
 *
 * Stage 1 (`1|stage`) preserves the current value as `<NAME>_PREVIOUS` in the
 * VERIFIER's own variable scope (the shared tier would not be inherited by
 * it), mints a new primary, and redeploys ONLY the verifier — the presenters
 * (bot-client, ai-worker, …) are deliberately NOT redeployed here, because they still hold
 * the outgoing value and the restarted verifier now accepts it as
 * `<NAME>_PREVIOUS`. Given the verifier's redeploy from a stage completes
 * before the next stage runs, there is no 401 window: every presenter's held
 * value matches one of the two the verifier accepts, both before and after
 * stage 1 — which is why each stage's output ends by naming what to wait for
 * before continuing.
 *
 * Stage 2 (`2|roll`) redeploys the verifier first and waits for that deployment
 * to reach `SUCCESS`, then redeploys every OTHER inheriting service onto the
 * new primary and records `<NAME>_ROLLED` (the SHA-256 of the current primary)
 * in the verifier's own scope once every presenter redeploy is accepted.
 *
 * Stage 3 (`3|finalize`, in `./rotate-env-stage3.ts`) refuses unless
 * `<NAME>_ROLLED` matches the current primary, preflights readiness across
 * every affected service, deletes `<NAME>_PREVIOUS` and `<NAME>_ROLLED` from
 * the verifier's scope, redeploys the verifier once more (so it stops accepting
 * the retired value), and stamps the rotation ledger — only stage 3 stamps it,
 * since an abandoned stage 1 must not read as a completed rotation.
 */

import crypto from 'node:crypto';
import chalk from 'chalk';

import { upsertRailwayVariable, readRailwayVariableValue } from '../deployment/railway-api.js';
import { confirmPrompt } from '../utils/confirm.js';
import { UsageError } from '../utils/errors.js';
import { checkDeployedCodeAcceptsPrevious } from './deployed-code-gate.js';
import {
  assertServicesDeploymentReady,
  redeployServices,
  reportRedeployFailures,
  type RotationContext,
  type StageArgs,
  type StagedRotationOptions,
} from './rotate-env-context.js';
import { runStage3 } from './rotate-env-stage3.js';
import {
  isWindowOpenForVerifier,
  assertPreviousReachesVerifier,
  isDegenerateWindow,
  readRollMarkerValue,
  refuseIfDegenerateWindow,
  rollMarkerName,
  writeRollMarker,
} from './rotate-env-window.js';
import {
  printDryRunNotice,
  refuseIfWindowClosed,
  printGateVerdict,
  stage1NextStep,
  stage1RedeployFailureError,
  STAGE2_NEXT_STEP,
  stage2RedeployFailureError,
} from './rotate-env-stage-output.js';
import { assertPresentersStillReady, redeployAndWaitForService } from './service-redeploy-wait.js';

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
    const degenerate = await isDegenerateWindow({
      context,
      env: options.env,
      verifier,
      previousName,
      primaryName: options.name,
    });
    if (!degenerate) {
      if (options.dryRun) {
        console.log(
          chalk.red(
            `\n⚠️  A rotation window is already open ("${previousName}" is set). A real run would ` +
              'REFUSE — run stage 2 (roll) then stage 3 (finalize) to close it before starting a ' +
              `new rotation. Stage 2 itself redeploys "${verifier.name}" and waits for it to ` +
              'reach SUCCESS first, so an interrupted stage 1 is recoverable by running stage 2.'
          )
        );
        printDryRunNotice();
        return;
      }
      throw new UsageError(
        `A rotation window is already open ("${previousName}" is set) — run stage 2 (roll) then ` +
          'stage 3 (finalize) to close it before starting a new rotation. Demoting the current ' +
          `value now would strand the original. Stage 2 itself redeploys "${verifier.name}" and ` +
          'waits for SUCCESS first, so an interrupted stage 1 is recoverable by running stage 2.'
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

  await assertServicesDeploymentReady([verifier], {
    environmentId: context.environmentId,
    env: options.env,
  });

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
    serviceId: verifier.id,
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

  // Read back the verifier's EFFECTIVE names before redeploying it. The deploy
  // gate above proves it RUNS code that accepts `_PREVIOUS`; this proves the
  // VALUE actually reaches that code. Refusing is the safe state — nothing has
  // been redeployed — and recovery is NOT another stage 1 run; see
  // `assertPreviousReachesVerifier` for why.
  await assertPreviousReachesVerifier({
    context,
    env: options.env,
    verifier,
    previousName,
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
        'would refuse, because the window is now open.',
      options.env,
      stage1NextStep(verifier.name)
    );
    throw stage1RedeployFailureError(verifier.name);
  }
}

async function runStage2(args: StageArgs): Promise<void> {
  const { options, context, verifier, previousName, windowOpen } = args;

  if (refuseIfWindowClosed(windowOpen, options.dryRun, previousName)) {
    return;
  }

  if (
    await refuseIfDegenerateWindow(args, {
      dryRun:
        `"${previousName}" still matches the current primary for "${options.name}" — the ` +
        'primary was never rotated. A real run would REFUSE — re-run stage 1 (it will now ' +
        'resume) instead.',
      refusal:
        `"${previousName}" still matches the current primary for "${options.name}" — the primary ` +
        'was never rotated. Re-run stage 1 (it will now resume) instead.',
    })
  ) {
    return;
  }

  const presenters = context.affectedServices.filter(svc => svc.id !== verifier.id);
  const rolledName = rollMarkerName(options.name);

  if (options.dryRun) {
    console.log(chalk.dim(`  Plan: redeploy "${verifier.name}" first and wait for SUCCESS`));
    console.log(
      chalk.dim(`  Plan: redeploy ${presenters.map(svc => svc.name).join(', ') || '(none)'}`)
    );
    console.log(
      chalk.dim(`  Plan: record completion marker "${rolledName}" in "${verifier.name}"'s scope`)
    );
    printDryRunNotice();
    return;
  }

  if (!options.yes) {
    const confirmed = await confirmPrompt(
      'This will restart the verifier and wait for SUCCESS, then redeploy every presenter.'
    );
    if (!confirmed) {
      console.log('Aborted.');
      return;
    }
  }

  const rollMarkerArgs = { context, env: options.env, verifier, primaryName: options.name };
  // Read the primary hash before the redeploys so a primary changed during the stage cannot satisfy stage 3.
  const rollMarkerValue = await readRollMarkerValue(rollMarkerArgs);

  const deployTarget = { environmentId: context.environmentId, env: options.env };
  await assertServicesDeploymentReady([verifier, ...presenters], deployTarget);
  await redeployAndWaitForService({ service: verifier, ...deployTarget });
  await assertPresentersStillReady({ presenters, ...deployTarget });
  const failures = await redeployServices(presenters, deployTarget);

  if (failures.length > 0) {
    console.log(chalk.yellow(`\n⚠️  Stage 2: ${failures.length} presenter(s) failed to redeploy`));
    reportRedeployFailures(
      failures,
      'Nothing was written — the verifier restarted and its new deployment reached SUCCESS (per the stage-2 wait).',
      options.env,
      STAGE2_NEXT_STEP
    );
    throw stage2RedeployFailureError(failures.length);
  }

  try {
    await writeRollMarker(rollMarkerArgs, rollMarkerValue);
  } catch (error) {
    throw new Error(
      `secrets:rotate-env stage 2: the presenters were redeployed, but completion could not be ` +
        `recorded in "${rolledName}" on "${verifier.name}". Re-run stage 2 once every service ` +
        'shows SUCCESS.',
      { cause: error }
    );
  }

  console.log(
    chalk.green(`\n✓ Stage 2 complete for "${options.name}" in Railway ${context.railwayEnvName}`)
  );
  console.log(
    chalk.dim(
      '  Next: pnpm ops secrets:rotate-env ' +
        `--env ${options.env} --name ${options.name} --stage 3`
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
  // Asked of the VERIFIER's effective set, not the shared tier: `_PREVIOUS` is
  // written to the verifier's own scope, and a shared-tier read would report
  // closed for an open window (and open for a stranded one).
  const windowOpen = await isWindowOpenForVerifier({
    context,
    env: options.env,
    verifier,
    previousName,
  });

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
