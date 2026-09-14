/**
 * `pnpm ops secrets:rotate-env` — rotate a SHARED (project-level) Railway
 * variable end to end: generate a new value locally, upsert it via the
 * Railway public GraphQL API, redeploy exactly the services that inherit
 * the name, then stamp the rotation ledger.
 *
 * Value safety: the new value travels in an HTTPS request BODY via
 * `upsertRailwayVariable` — it never reaches argv and never reaches stdout.
 * This is a deliberate improvement over `setServiceVariables` in
 * `./rotation.ts`, whose `railway variables --set K=V` form exposes the
 * value via `/proc/<pid>/cmdline` (readable by same-privilege processes) for
 * the duration of that call. This command deliberately does NOT route
 * through `setServiceVariables` for exactly that reason.
 *
 * The mismatch window: api-gateway compares against ONE value loaded at
 * startup — there is no `_PREVIOUS` acceptance for a plain shared secret
 * (contrast the staged BYOK rotation in `./rotation.ts`, which has one).
 * bot-client and ai-worker PRESENT the secret; api-gateway VERIFIES it. With
 * a single shared value, no redeploy ordering removes the window: whichever
 * side restarts first, the other briefly holds the stale value and gets a
 * 401 until its own redeploy completes. This command does not attempt a
 * staged rotation for this class of secret — eliminating the window needs
 * dual-secret acceptance in api-gateway, a runtime change out of scope here.
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

import {
  requireRailwayApiToken,
  upsertRailwayVariable,
  redeployRailwayService,
  listRailwayVariableNames,
} from '../deployment/railway-api.js';
import { listRailwayServices } from '../deployment/railway-status.js';
import { confirmPrompt } from '../utils/confirm.js';
import { getRailwayEnvName } from '../utils/env-runner.js';
import { UsageError } from '../utils/errors.js';
import { markSecretRotated } from './rotation.js';

export interface RotateEnvSecretOptions {
  env: 'dev' | 'prod';
  name: string;
  dryRun: boolean;
  yes: boolean;
}

const MISMATCH_WINDOW_NOTE =
  'Mismatch window: api-gateway verifies against a single value loaded at startup, so ' +
  'whichever service (bot-client/ai-worker/api-gateway) redeploys first is briefly out of ' +
  'sync with the others and may see a 401 until every redeploy completes.';

interface RedeployFailure {
  name: string;
  error: unknown;
}

/** Print each redeploy failure loudly, with the repair instruction — never "re-run this command". */
function reportRedeployFailures(failures: RedeployFailure[]): void {
  console.log(chalk.red(`\n⚠️  ${failures.length} service(s) failed to redeploy:`));
  for (const failure of failures) {
    console.log(
      chalk.red(
        `  - ${failure.name}: ${failure.error instanceof Error ? failure.error.message : 'unknown error'}`
      )
    );
  }
  console.log(
    chalk.red(
      '\nThe variable WAS rotated successfully. Repair the lagging service(s) from the Railway ' +
        'dashboard or `railway redeploy --service <name>` — do NOT re-run ' +
        '`pnpm ops secrets:rotate-env`, which would mint a THIRD value and widen the split.'
    )
  );
}

interface RailwayListContext {
  projectId: string;
  environmentId: string;
  env: 'dev' | 'prod';
}

/**
 * Derived, never hardcoded — a service's variable list is the only source of truth for
 * whether it inherits the shared name.
 *
 * Unverified assumption: `listRailwayVariableNames` returns Railway's MERGED per-service
 * view, so a service carrying its OWN service-level override of `name` is indistinguishable
 * here from one that only inherits the shared value — both simply have `name` in `names`.
 * If that ever happens, this function still marks the service "affected": it gets redeployed
 * and reported as rotated, but its override means it keeps running its unchanged local value.
 * That failure is silent — no error, just a misleading rotation summary.
 */
async function computeAffectedServices(
  services: { id: string; name: string }[],
  name: string,
  context: RailwayListContext
): Promise<{ id: string; name: string }[]> {
  const affected: { id: string; name: string }[] = [];
  for (const svc of services) {
    let names: string[];
    try {
      names = await listRailwayVariableNames({ ...context, serviceId: svc.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Listing variables for service "${svc.name}" failed: ${message}`, {
        cause: error,
      });
    }
    if (names.includes(name)) {
      affected.push(svc);
    }
  }
  return affected;
}

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
  failures: RedeployFailure[];
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

/** Stamp the ledger; a failure here is reported, never mistaken for a failed rotation. */
async function stampLedger(env: 'dev' | 'prod', ledgerName: string): Promise<boolean> {
  try {
    await markSecretRotated({ env, name: ledgerName });
    return true;
  } catch (error) {
    console.log(
      chalk.red(
        `\n⚠️  Rotation succeeded but the ledger stamp failed ` +
          `(${error instanceof Error ? error.message : 'unknown error'}). Run this by hand:\n` +
          `  pnpm ops secrets:mark-rotated ${ledgerName} --env ${env}`
      )
    );
    return false;
  }
}

export async function runRotateEnvSecret(options: RotateEnvSecretOptions): Promise<void> {
  requireRailwayApiToken(options.env);

  const { projectId, environmentId, services } = listRailwayServices(options.env);

  const sharedNames = await listRailwayVariableNames({
    projectId,
    environmentId,
    env: options.env,
  });
  if (!sharedNames.includes(options.name)) {
    throw new UsageError(
      `"${options.name}" is not a shared (project-level) variable in Railway ` +
        `${getRailwayEnvName(options.env)} — secrets:rotate-env ROTATES an existing shared ` +
        'variable, it does not create one.'
    );
  }

  const affectedServices = await computeAffectedServices(services, options.name, {
    projectId,
    environmentId,
    env: options.env,
  });

  const railwayEnvName = getRailwayEnvName(options.env);
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

  const failures: RedeployFailure[] = [];
  for (const svc of affectedServices) {
    try {
      await redeployRailwayService({ environmentId, serviceId: svc.id, env: options.env });
    } catch (error) {
      failures.push({ name: svc.name, error });
    }
  }

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
    reportRedeployFailures(failures);
    throw new Error(
      `secrets:rotate-env: the variable was rotated successfully, but ${failures.length} ` +
        `service(s) failed to redeploy: ${failures.map(f => f.name).join(', ')}. Do NOT re-run ` +
        'this command — redeploy the lagging service(s) by hand (Railway dashboard or ' +
        '`railway redeploy --service <name>`).'
    );
  }
}
