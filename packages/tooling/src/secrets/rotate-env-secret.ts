/**
 * `pnpm ops secrets:rotate-env` — rotate a SHARED (project-level) Railway
 * variable end to end.
 *
 * Two paths, resolved by whether the name is registered in
 * `./rotate-env-stages.ts`'s dual-acceptance registry:
 *
 * - A registry name (its VERIFIER service accepts `<NAME>_PREVIOUS`) MUST go
 *   through the staged flow in `./rotate-env-stages.ts` — `--stage` is
 *   required, and there is no 401 window at any point in the three stages.
 * - Every other name takes the single-shot path below: generate a new value
 *   locally, upsert it via the Railway public GraphQL API, redeploy exactly
 *   the services that inherit the name, then stamp the rotation ledger. This
 *   path still has the mismatch window described below, because api-gateway
 *   (or whichever service verifies the secret) compares against ONE value
 *   loaded at startup with no `_PREVIOUS` acceptance.
 *
 * Value safety: the new value travels in an HTTPS request BODY via
 * `upsertRailwayVariable` — it never reaches argv and never reaches stdout.
 * This is a deliberate improvement over `setServiceVariables` in
 * `./rotation.ts`, whose `railway variables --set K=V` form exposes the
 * value via `/proc/<pid>/cmdline` (readable by same-privilege processes) for
 * the duration of that call. This command deliberately does NOT route
 * through `setServiceVariables` for exactly that reason.
 *
 * The mismatch window (single-shot path only): the verifier compares against
 * ONE value loaded at startup. bot-client and ai-worker PRESENT the secret;
 * api-gateway VERIFIES it. With a single shared value, no redeploy ordering
 * removes the window: whichever side restarts first, the other briefly holds
 * the stale value and gets a 401 until its own redeploy completes.
 *
 * If the process is interrupted between the upsert and the redeploy loop
 * (killed, crashed, network drop), the result is the same hazard as a
 * partial redeploy failure below, just silent: the new value is already live
 * while some or all services still run the old one. The repair is the same —
 * redeploy the affected services by hand (Railway dashboard or `railway
 * redeploy --service <name>`) — and the same "do NOT re-run this command"
 * guidance applies, since re-running mints a THIRD value and widens the split.
 */

import crypto from 'node:crypto';
import chalk from 'chalk';

import { upsertRailwayVariable } from '../deployment/railway-api.js';
import { confirmPrompt } from '../utils/confirm.js';
import { UsageError } from '../utils/errors.js';
import { getDualAcceptance, resolveStageAlias, runStagedRotation } from './rotate-env-stages.js';
import {
  resolveRotationContext,
  redeployServices,
  reportRedeployFailures,
  stampLedger,
} from './rotate-env-context.js';

export interface RotateEnvSecretOptions {
  env: 'dev' | 'prod';
  name: string;
  dryRun: boolean;
  yes: boolean;
  stage?: string;
}

const MISMATCH_WINDOW_NOTE =
  'Mismatch window: api-gateway verifies against a single value loaded at startup, so ' +
  'whichever service (bot-client/ai-worker/api-gateway) redeploys first is briefly out of ' +
  'sync with the others and may see a 401 until every redeploy completes.';

/**
 * Guard against rotating a variable no service actually inherits — the new value would go
 * live in the shared tier while every service keeps running the old one, surfacing as a
 * surprise 401 mismatch at the next unrelated deploy. Returns `true` when the caller should
 * return immediately (the dry-run arm); throws on a real run.
 */
function guardEmptyAffectedServices(
  affectedServiceCount: number,
  options: RotateEnvSecretOptions,
  railwayEnvName: string
): boolean {
  if (affectedServiceCount > 0) {
    return false;
  }
  if (options.dryRun) {
    console.log(
      chalk.red(
        `\n⚠️  No service in Railway ${railwayEnvName} inherits "${options.name}". A real run would ` +
          'REFUSE — rotating it now would change nothing and would surface as a surprise mismatch at ' +
          'the next unrelated deploy.'
      )
    );
    console.log(chalk.green('\n[DRY RUN] No changes made.'));
    return true;
  }
  throw new UsageError(
    `No service in Railway ${railwayEnvName} inherits "${options.name}" — rotating it now would change ` +
      'nothing and would surface as a surprise mismatch at the next unrelated deploy.'
  );
}

interface RotationSummaryArgs {
  name: string;
  railwayEnvName: string;
  affectedServices: { id: string; name: string }[];
  failures: { name: string; error: unknown }[];
  ledgerName: string;
  ledgerStamped: boolean;
}

/**
 * Print the post-rotation summary block. The headline wording branches on
 * whether every redeploy succeeded — a plain unqualified `✓` when a failure
 * is about to be reported directly below it would read as unqualified
 * success even though the failure block right after contradicts it.
 */
function printRotationSummary(args: RotationSummaryArgs): void {
  const { name, railwayEnvName, affectedServices, failures, ledgerName, ledgerStamped } = args;

  if (failures.length > 0) {
    console.log(
      chalk.yellow(
        `\n⚠️  Rotated "${name}" (shared) in Railway ${railwayEnvName}, but ` +
          `${failures.length} service(s) failed to redeploy`
      )
    );
  } else {
    console.log(chalk.green(`\n✓ Rotated "${name}" (shared) in Railway ${railwayEnvName}`));
  }
  // Only the services whose redeploy actually succeeded — naming every affected
  // service here would contradict the failure block below.
  const failedNames = new Set(failures.map(failure => failure.name));
  const redeployedNames =
    affectedServices
      .filter(svc => !failedNames.has(svc.name))
      .map(svc => svc.name)
      .join(', ') || '(none)';
  console.log(chalk.dim(`  Services redeployed: ${redeployedNames}`));
  console.log(
    chalk.dim(
      `  Ledger: ${ledgerStamped ? `${ledgerName} stamped` : 'NOT stamped — run the command above'}`
    )
  );
  console.log(chalk.dim(`  ${MISMATCH_WINDOW_NOTE}`));
}

async function runSingleShotRotation(
  options: RotateEnvSecretOptions,
  context: Awaited<ReturnType<typeof resolveRotationContext>>
): Promise<void> {
  const { projectId, environmentId, railwayEnvName, affectedServices } = context;

  const affectedNames = affectedServices.map(svc => svc.name).join(', ') || '(none)';
  console.log(chalk.yellow(`\nAbout to rotate Railway variable "${options.name}"`));
  console.log(chalk.dim(`  Environment: ${railwayEnvName}`));
  console.log(chalk.dim('  Tier: shared (project-level)'));
  console.log(chalk.dim(`  Affected services: ${affectedNames}`));
  console.log(chalk.dim(`  ${MISMATCH_WINDOW_NOTE}`));

  if (guardEmptyAffectedServices(affectedServices.length, options, railwayEnvName)) {
    return;
  }

  if (options.env === 'prod' && options.yes) {
    throw new UsageError(
      '--yes is refused on prod for secrets:rotate-env — a live secret rotation with a ' +
        'user-visible 401 window always gets a human at the keyboard.'
    );
  }

  if (options.dryRun) {
    console.log(chalk.green('\n[DRY RUN] No changes made.'));
    return;
  }

  if (!options.yes) {
    const confirmed = await confirmPrompt(
      'This will rotate the variable above and redeploy every affected service.'
    );
    if (!confirmed) {
      console.log('Aborted.');
      return;
    }
  }

  const value = crypto.randomBytes(32).toString('hex');

  await upsertRailwayVariable({
    projectId,
    environmentId,
    name: options.name,
    value,
    skipDeploys: true,
    env: options.env,
  });

  const failures = await redeployServices(affectedServices, { environmentId, env: options.env });

  const ledgerName = options.name.toLowerCase().replaceAll('_', '-');
  const ledgerStamped = await stampLedger(options.env, ledgerName);

  printRotationSummary({
    name: options.name,
    railwayEnvName,
    affectedServices,
    failures,
    ledgerName,
    ledgerStamped,
  });

  if (failures.length > 0) {
    reportRedeployFailures(
      failures,
      'The variable was rotated successfully; re-running would mint a THIRD value and widen the split.'
    );
    throw new Error(
      `secrets:rotate-env: the variable was rotated successfully, but ${failures.length} ` +
        `service(s) failed to redeploy: ${failures.map(f => f.name).join(', ')}. Do NOT re-run ` +
        'this command — redeploy the lagging service(s) by hand (Railway dashboard or ' +
        '`railway redeploy --service <name>`).'
    );
  }
}

export async function runRotateEnvSecret(options: RotateEnvSecretOptions): Promise<void> {
  // Routing is resolved BEFORE any IO: a name/stage mismatch is a usage error,
  // not something to discover after a Railway round trip. The same applies to
  // an invalid stage VALUE on a registered name — resolving it here means an
  // unknown stage never reaches `resolveRotationContext`'s Railway calls.
  const dual = getDualAcceptance(options.name);
  const stage = options.stage;

  if (dual === undefined && stage !== undefined) {
    throw new UsageError(
      `No verifier accepts a "${options.name}_PREVIOUS" value, so staging the rotation of ` +
        `"${options.name}" would open a window nothing closes. Re-run without --stage.`
    );
  }
  if (dual !== undefined && stage === undefined) {
    throw new UsageError(
      `"${options.name}" rotates through the staged flow — --stage is required ` +
        '(1|stage, 2|roll, 3|finalize). Stage 1 preserves the current value as ' +
        `"${options.name}_PREVIOUS" and redeploys only the verifier; stage 2 rolls the ` +
        'presenters; stage 3 closes the window.'
    );
  }
  if (dual !== undefined && stage !== undefined && resolveStageAlias(stage) === undefined) {
    throw new UsageError(`Unknown stage "${stage}" — use 1|stage, 2|roll, or 3|finalize.`);
  }

  const context = await resolveRotationContext({ env: options.env, name: options.name });

  if (dual !== undefined && stage !== undefined) {
    await runStagedRotation(
      {
        env: options.env,
        name: options.name,
        stage,
        dryRun: options.dryRun,
        yes: options.yes,
        verifierService: dual.verifierService,
      },
      context
    );
    return;
  }

  await runSingleShotRotation(options, context);
}
