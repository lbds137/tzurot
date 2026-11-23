/**
 * Wait until a SUPERSEDED Railway deployment reaches a not-live status.
 *
 * A replacement deployment reaching `SUCCESS` does not prove the one it replaced
 * has stopped: both can serve traffic for a short overlap. BYOK stage 1 uses this
 * to hold the key swap until no process from before the redeploy is still live.
 *
 * Fails closed: the wait returns only on a status in `NOT_LIVE_STATUSES`
 * (`REMOVED`, `SKIPPED`, `FAILED`), the same terminal set the pre-swap live-deployment
 * check uses, so the two gates share one definition. `CRASHED` is deliberately not
 * terminal: a restart policy can revive it, so it counts as possibly live and the
 * wait keeps polling. The dev probe found no superseded CRASHED deployment in
 * either service's history (prod not probed); if one stays CRASHED, the timeout
 * message says to remove it in the dashboard. `REMOVING`, `SUCCESS` and any other
 * string keep polling; a thrown status read (including an unexpected response
 * shape) counts as a poll error, more than `MAX_CONSECUTIVE_POLL_ERRORS` in a row
 * throws, and a passed deadline throws.
 *
 * Probed on dev: a superseded deployment reaches `REMOVED`, within a few seconds
 * of its replacement's `SUCCESS` in two dev observations. `REMOVING` exists in
 * the status enum and is not enough. Not verified: a worst-case bound, so the
 * deadline is a fail-closed guard rather than a measured value. The unit tests
 * inject the status fetcher.
 */

import chalk from 'chalk';
import {
  getRailwayDeploymentStatus,
  NOT_LIVE_STATUSES,
} from '../deployment/railway-deployment-status.js';
import type { RailwayEnv } from '../deployment/railway-api.js';
import {
  DEFAULT_SERVICE_POLL_INTERVAL_MS,
  DEFAULT_SERVICE_WAIT_TIMEOUT_MS,
  MAX_CONSECUTIVE_POLL_ERRORS,
} from './service-redeploy-wait.js';

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function pollFailureError(args: {
  serviceName: string;
  deploymentId: string;
  env: RailwayEnv;
  consecutiveErrors: number;
  rerunNote: string;
  error: unknown;
}): Error {
  const { serviceName, deploymentId, env, consecutiveErrors, rerunNote, error } = args;
  const detail = error instanceof Error ? error.message : 'unknown error';
  return new Error(
    `Reading the status of ${serviceName}'s previous deployment ${deploymentId} (${env}) failed ${consecutiveErrors} consecutive times (last error: ${detail}) — ${rerunNote}`,
    { cause: error }
  );
}

export async function waitForDeploymentRemoved(args: {
  deploymentId: string;
  serviceName: string;
  env: RailwayEnv;
  /** Closing clause of every refusal: what was left untouched and how to re-run. */
  rerunNote: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  getDeploymentStatus?: typeof getRailwayDeploymentStatus;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<void> {
  const {
    deploymentId,
    serviceName,
    env,
    rerunNote,
    timeoutMs = DEFAULT_SERVICE_WAIT_TIMEOUT_MS,
    pollIntervalMs = DEFAULT_SERVICE_POLL_INTERVAL_MS,
    getDeploymentStatus = getRailwayDeploymentStatus,
    sleep = defaultSleep,
    now = Date.now,
  } = args;

  const startMs = now();
  let consecutiveErrors = 0;
  let lastStatus: string | undefined;

  for (;;) {
    try {
      const status = await getDeploymentStatus({ deploymentId, env });
      consecutiveErrors = 0;
      if (status !== lastStatus) {
        console.log(chalk.dim(`  ${serviceName} previous deployment ${deploymentId}: ${status}`));
        lastStatus = status;
      }
      if ((NOT_LIVE_STATUSES as readonly string[]).includes(status)) {
        return;
      }
    } catch (error: unknown) {
      consecutiveErrors += 1;
      if (consecutiveErrors > MAX_CONSECUTIVE_POLL_ERRORS) {
        throw pollFailureError({
          serviceName,
          deploymentId,
          env,
          consecutiveErrors,
          rerunNote,
          error,
        });
      }
    }

    if (now() - startMs >= timeoutMs) {
      const crashedClause =
        lastStatus === 'CRASHED'
          ? 'CRASHED counts as possibly live, so the operator must remove or stop that deployment in the Railway dashboard before re-running; '
          : '';
      throw new Error(
        `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${serviceName}'s previous deployment ${deploymentId} (${env}) to reach REMOVED (last observed status: ${lastStatus ?? 'none'}) or SKIPPED or FAILED (also not live) — its process may still be running without the new decrypt key; ${crashedClause}${rerunNote}`
      );
    }
    await sleep(pollIntervalMs);
  }
}
