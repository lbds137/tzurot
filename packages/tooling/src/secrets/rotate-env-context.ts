/**
 * Shared Railway/rotation-context plumbing used by both the single-shot and
 * the staged `secrets:rotate-env` paths: resolving project/environment ids,
 * deriving which services actually inherit a shared variable, redeploying a
 * set of services and collecting failures, and stamping the rotation ledger.
 */

import chalk from 'chalk';

import {
  requireRailwayApiToken,
  redeployRailwayService,
  listRailwayVariableNames,
} from '../deployment/railway-api.js';
import { listRailwayServices } from '../deployment/railway-status.js';
import { getRailwayEnvName } from '../utils/env-runner.js';
import { UsageError } from '../utils/errors.js';
import { markSecretRotated } from './rotation.js';

export interface RotationListContext {
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
export async function computeAffectedServices(
  services: { id: string; name: string }[],
  name: string,
  context: RotationListContext
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

export interface RedeployFailure {
  name: string;
  error: unknown;
}

/**
 * Print each redeploy failure loudly, with the repair instruction — never
 * "re-run this command". `consequence` is REQUIRED and carries the
 * situation-specific sentence describing what actually happened (a rotation,
 * a delete, or nothing at all) — this helper has one caller in the
 * single-shot path and three in the staged path, and only the single-shot
 * caller's redeploy failure follows a completed rotation. A default here
 * would silently reproduce that single-shot wording at a staged call site.
 */
export function reportRedeployFailures(failures: RedeployFailure[], consequence: string): void {
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
      `\n${consequence} Repair the lagging service(s) from the Railway dashboard or ` +
        '`railway redeploy --service <name>` — do NOT re-run this command.'
    )
  );
}

/** Stamp the ledger; a failure here is reported, never mistaken for a failed rotation. */
export async function stampLedger(env: 'dev' | 'prod', ledgerName: string): Promise<boolean> {
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

export interface RotationContext {
  projectId: string;
  environmentId: string;
  railwayEnvName: string;
  /** Shared-tier (project-level) variable NAMES. Values are never read here. */
  sharedNames: string[];
  services: { id: string; name: string }[];
  /** The subset of `services` that inherits the rotated name, derived per run. */
  affectedServices: { id: string; name: string }[];
}

/**
 * Resolve everything both the single-shot and the staged rotation paths need:
 * the Railway ids, the shared-tier name list, and the DERIVED set of services
 * that inherit the name. Never hardcodes the inheriting set.
 *
 * Throws `UsageError` when the name is not a shared (project-level) variable —
 * this command rotates an existing shared variable, it does not create one.
 */
export async function resolveRotationContext(options: {
  env: 'dev' | 'prod';
  name: string;
}): Promise<RotationContext> {
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

  return { projectId, environmentId, railwayEnvName, sharedNames, services, affectedServices };
}

/**
 * Redeploy each service in order and COLLECT failures rather than aborting —
 * a partial failure is reported with its repair instruction, never retried by
 * re-running the command.
 */
export async function redeployServices(
  services: { id: string; name: string }[],
  context: { environmentId: string; env: 'dev' | 'prod' }
): Promise<RedeployFailure[]> {
  const failures: RedeployFailure[] = [];
  for (const svc of services) {
    try {
      await redeployRailwayService({
        environmentId: context.environmentId,
        serviceId: svc.id,
        env: context.env,
      });
    } catch (error) {
      failures.push({ name: svc.name, error });
    }
  }
  return failures;
}
