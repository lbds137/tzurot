/**
 * Stage 3 (`3|finalize`) of the staged `secrets:rotate-env` rotation.
 *
 * Refuses unless `<NAME>_PREVIOUS` is set and distinct from the primary AND
 * `<NAME>_ROLLED` matches the SHA-256 of the current primary (proving stage 2
 * finished for this primary), preflights deployment readiness across the
 * verifier and every other inheriting service, deletes `<NAME>_PREVIOUS` and
 * `<NAME>_ROLLED` from the verifier's scope, redeploys the verifier once more,
 * and stamps the rotation ledger.
 */

import chalk from 'chalk';

import { deleteRailwayVariable } from '../deployment/railway-api.js';
import { confirmPrompt } from '../utils/confirm.js';
import { UsageError } from '../utils/errors.js';
import {
  assertServicesDeploymentReady,
  redeployServices,
  reportRedeployFailures,
  stampLedger,
  type StageArgs,
} from './rotate-env-context.js';
import {
  printDryRunNotice,
  refuseIfWindowClosed,
  stage3NextStep,
  stage3RedeployFailureError,
} from './rotate-env-stage-output.js';
import {
  deleteRollMarker,
  isRollComplete,
  refuseIfDegenerateWindow,
  rollMarkerName,
} from './rotate-env-window.js';

async function refuseIfDegenerateOrUnrolled(args: StageArgs): Promise<boolean> {
  const { options, context, verifier, previousName } = args;

  // A degenerate window here means the primary was NEVER rotated — only stage 1's
  // first upsert (preserving `_PREVIOUS`) landed, never its second (minting a fresh
  // primary). Closing the window in that state would stamp the ledger for a
  // rotation that did not happen, silently defeating the cadence guarantee. Checked
  // before the dry-run plan below so `--dry-run` reports what a real run would do.
  if (
    await refuseIfDegenerateWindow(args, {
      dryRun:
        `"${previousName}" still matches the current primary for "${options.name}" — the ` +
        'primary was never rotated. A real run would REFUSE to stamp the ledger for a ' +
        'rotation that did not happen — re-run stage 1 (it will now resume) instead.',
      refusal:
        `"${previousName}" still matches the current primary for "${options.name}" — the primary ` +
        'was never rotated, so closing the window here would stamp the ledger for a rotation ' +
        'that did not happen. Re-run stage 1 (it will now resume) instead.',
    })
  ) {
    return true;
  }

  const rollComplete = await isRollComplete({
    context,
    env: options.env,
    verifier,
    primaryName: options.name,
  });
  if (!rollComplete) {
    const stage2Command = `pnpm ops secrets:rotate-env --env ${options.env} --name ${options.name} --stage 2`;
    if (options.dryRun) {
      console.log(
        chalk.red(
          `\n⚠️  Stage 2 has not finished for the current "${options.name}" primary — presenters ` +
            'may still hold the old value, and closing the window now would make them fail ' +
            `authentication. A real run would REFUSE — run stage 2 (roll) first (\`${stage2Command}\`), ` +
            'then stage 3. Repeating stage 2 is safe while the window is open.'
        )
      );
      printDryRunNotice();
      return true;
    }
    throw new UsageError(
      `Stage 2 has not finished for the current "${options.name}" primary — presenters may still ` +
        'hold the old value, and closing the window now would make them fail authentication. ' +
        `Run stage 2 (roll) first (\`${stage2Command}\`), then stage 3. Repeating stage 2 is safe ` +
        'while the window is open.'
    );
  }

  return false;
}

export async function runStage3(args: StageArgs): Promise<void> {
  const { options, context, verifier, previousName, windowOpen } = args;
  const ledgerName = options.name.toLowerCase().replaceAll('_', '-');
  const rolledName = rollMarkerName(options.name);
  const closedWindowNote =
    `If an earlier stage 3 was interrupted after deleting "${previousName}", do NOT start a new ` +
    `rotation: redeploy "${verifier.name}" with ` +
    `\`pnpm ops deploy:redeploy --env ${options.env} --service ${verifier.name} --yes\` and ` +
    `stamp with \`pnpm ops secrets:mark-rotated ${ledgerName} --env ${options.env}\`; ` +
    `a "${rolledName}" left behind is harmless and can be removed with ` +
    `\`pnpm ops deploy:var-delete --env ${options.env} --service ${verifier.name} --name ${rolledName} --yes\`.`;

  if (refuseIfWindowClosed(windowOpen, options.dryRun, previousName, closedWindowNote)) {
    return;
  }

  if (await refuseIfDegenerateOrUnrolled(args)) {
    return;
  }

  if (options.dryRun) {
    console.log(chalk.dim(`  Plan: delete "${previousName}" from "${verifier.name}"'s scope`));
    console.log(chalk.dim(`  Plan: delete "${rolledName}" from "${verifier.name}"'s scope`));
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

  const otherServices = context.affectedServices.filter(svc => svc.id !== verifier.id);
  await assertServicesDeploymentReady([verifier, ...otherServices], {
    environmentId: context.environmentId,
    env: options.env,
  });

  // Deleted, not upserted as '' (the Railway CLI rejects an empty value, and
  // the API can delete).
  //
  // Unlike stage 1's upserts (both pass `skipDeploys: true`), Railway's
  // `VariableDeleteInput` carries no `skipDeploys` field at all — probed by
  // live GraphQL introspection, so there is nothing to pass on either delete
  // below (`_PREVIOUS` or `_ROLLED`). Whether Railway auto-redeploys the
  // verifier on a variable delete is UNVERIFIED (either for a referenced
  // variable like `_PREVIOUS` or for the `_ROLLED` marker); if either delete
  // triggers a deployment, that deployment is in flight when the explicit
  // redeploy below runs, and the redeploy helper refuses a latest deployment
  // that is not SUCCESS — the failure text then sends the operator to the
  // dashboard first, with `deploy:redeploy` as the retry. Any such deploy and
  // the explicit redeploy would land on the same post-delete configuration.
  await deleteRailwayVariable({
    projectId: context.projectId,
    environmentId: context.environmentId,
    serviceId: verifier.id,
    name: previousName,
    env: options.env,
  });

  try {
    await deleteRollMarker({
      context,
      env: options.env,
      verifier,
      primaryName: options.name,
    });
  } catch (error) {
    console.log(
      chalk.yellow(
        `  ⚠️  Could not delete completion marker "${rolledName}" from "${verifier.name}": ` +
          `${error instanceof Error ? error.message : String(error)} ` +
          '(a leftover marker is harmless because the hash stops matching once the primary changes and stage 3 refuses a primary never rotated); clean it up with:\n' +
          `  pnpm ops deploy:var-delete --env ${options.env} --service ${verifier.name} --name ${rolledName} --yes`
      )
    );
  }

  const failures = await redeployServices([verifier], {
    environmentId: context.environmentId,
    env: options.env,
  });

  // Stamped only when the verifier's redeploy succeeded: `_PREVIOUS` is gone from
  // Railway's store either way, but a still-running verifier loaded its env at
  // process start and keeps accepting the retired value in memory until it
  // restarts — stamping here would record a completed rotation (and reset the
  // overdue-nag interval) while the acceptance window is still open in practice.
  if (failures.length > 0) {
    reportRedeployFailures(
      failures,
      `"${previousName}" was deleted, so the retired value is gone from Railway's store, but the ` +
        'un-redeployed verifier may still accept it in memory.',
      options.env,
      stage3NextStep({ verifierName: verifier.name, failures, ledgerName, env: options.env })
    );
    throw stage3RedeployFailureError({
      previousName,
      verifierName: verifier.name,
      failures,
      ledgerName,
      env: options.env,
    });
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
