/**
 * Stage 2's verifier-redeploy guarantee for `secrets:rotate-env`.
 *
 * Stage 1 upserts `<NAME>_PREVIOUS` and the new primary with `skipDeploys: true`,
 * then triggers a verifier redeploy. If stage 1 is interrupted between the
 * variable writes and the redeploy, the verifier's `latestDeployment` still
 * reports `SUCCESS` on the pre-rotation deployment — which `assertServicesDeploymentReady`
 * cannot distinguish from a completed stage-1 redeploy, and Railway's
 * `variablesForServiceDeployment` query cannot detect because it reports what the
 * NEXT deployment would receive rather than what the running container holds.
 *
 * Stage 2 therefore guarantees the verifier is running a post-write deployment by
 * redeploying the verifier itself (reusing its current image via
 * `redeployRailwayServiceReusingImageWithSource`, which returns both the source
 * deployment id it redeployed from and the new deployment id) and polling until
 * `serviceInstance.latestDeployment` both matches the NEW deployment id and
 * reaches `SUCCESS`, before any presenter is redeployed.
 *
 * Observed against the live Railway API in two dev runs, not pinned by a test:
 * the id returned by the redeploy is the id latestDeployment reports; statuses
 * seen for it were INITIALIZING, DEPLOYING, SUCCESS (no BUILDING, the image is
 * reused; the second run saw INITIALIZING first); stage 2 completed in about
 * 16-22 seconds.
 *
 * Not verified against the live Railway API: a superseding third deployment id
 * appearing during the wait, `NEEDS_APPROVAL`, or whether stale-id polls (returning
 * the source deployment id or timing out on `previous deployment`) occur in
 * practice. Stale-id polls keep waiting, `NEEDS_APPROVAL` and terminal failure
 * statuses (`FAILED`, `CRASHED`, `REMOVED`, `SKIPPED`) refuse immediately, a
 * third deployment id fails fast as superseding ours, and any other non-`SUCCESS`
 * status falls back to the poll timeout path (all pinned in
 * `verifier-redeploy-wait.test.ts`).
 *
 * `SAFE_RERUN_NOTE` claims that redeploying the verifier in stage 2 is
 * idempotent while the dual-acceptance window is open: stage 2 cannot reach
 * `redeployAndWaitForVerifier` outside an open window because `runStage2` in
 * `rotate-env-stages.ts` calls `refuseIfWindowClosed` (`rotate-env-stage-output.ts`)
 * first (pinned by `stage 2 refuses when no window is open` and its no-redeploy
 * companion test in `rotate-env-stages.test.ts`).
 *
 * `timeoutMs` is a soft budget because the deadline is only checked after a
 * successful poll, so up to `MAX_CONSECUTIVE_POLL_ERRORS` failed polls (each
 * bounded by `RAILWAY_API_TIMEOUT_MS` (applied via `AbortSignal.timeout` in
 * `railwayGraphql`, `deployment/railway-api.ts`) plus one sleep) can overshoot it.
 */

import chalk from 'chalk';

import {
  getRailwayServiceLatestDeployment,
  redeployRailwayServiceReusingImageWithSource,
  type RailwayEnv,
  type RailwayServiceLatestDeployment,
} from '../deployment/railway-api.js';

export const DEFAULT_VERIFIER_WAIT_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_VERIFIER_POLL_INTERVAL_MS = 5 * 1000;
/** Maximum consecutive `getLatestDeployment` rejections tolerated before aborting the wait. */
export const MAX_CONSECUTIVE_POLL_ERRORS = 3;

const TERMINAL_BAD_STATUSES = new Set(['FAILED', 'CRASHED', 'REMOVED', 'SKIPPED']);

const SAFE_RERUN_NOTE =
  'nothing was redeployed on presenters. Re-running stage 2 is safe because ' +
  'redeploying the verifier is idempotent while the dual-acceptance window is open.';

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function describeObservedStatus(
  latest: RailwayServiceLatestDeployment | null,
  newDeploymentId: string
): string {
  if (latest === null) {
    return 'missing';
  }
  if (latest.id !== newDeploymentId) {
    return `previous deployment (${latest.status})`;
  }
  return latest.status;
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

function formatRedeployTriggerError(verifierName: string, env: RailwayEnv, error: unknown): Error {
  return new Error(
    `The redeploy request for verifier "${verifierName}" (${env}) failed or returned an unexpected shape ` +
      `(${errorDetail(error)}) — the verifier may already be restarting; ${SAFE_RERUN_NOTE}`
  );
}

function formatPollFailureError(
  verifierName: string,
  env: RailwayEnv,
  consecutivePollErrors: number,
  error: unknown
): Error {
  return new Error(
    `Polling latest deployment for verifier "${verifierName}" (${env}) failed ` +
      `${consecutivePollErrors} consecutive times (last error: ${errorDetail(error)}) — ${SAFE_RERUN_NOTE}`
  );
}

function formatPresenterReadError(presenterName: string, error: unknown): Error {
  return new Error(
    'Stage 2 restarted the verifier and it reached SUCCESS, but reading presenter ' +
      `"${presenterName}" failed (${errorDetail(error)}) — no presenter was redeployed. ` +
      'Re-run stage 2; it repeats the verifier redeploy and is safe while the dual-acceptance window is open.'
  );
}

interface PollEvaluationContext {
  newDeploymentId: string;
  previousDeploymentId: string;
  verifierName: string;
  env: RailwayEnv;
  lastPrintedStatus: string | undefined;
}

function evaluateNewDeploymentStatus(
  latest: RailwayServiceLatestDeployment | null,
  context: PollEvaluationContext
): { done: boolean; lastPrintedStatus: string | undefined } {
  const { newDeploymentId, previousDeploymentId, verifierName, env, lastPrintedStatus } = context;
  if (latest === null) {
    return { done: false, lastPrintedStatus };
  }
  if (latest.id !== newDeploymentId) {
    if (latest.id === previousDeploymentId) {
      return { done: false, lastPrintedStatus };
    }
    throw new Error(
      `Stage 2 redeployed verifier "${verifierName}" (${env}), but a different deployment ` +
        `(${latest.id}, ${latest.status}) became the latest during the wait and supersedes ours — ` +
        `check it reached SUCCESS in Railway, then re-run stage 2 (${SAFE_RERUN_NOTE})`
    );
  }
  let nextPrintedStatus = lastPrintedStatus;
  if (latest.status !== lastPrintedStatus) {
    console.log(
      chalk.dim(`  Verifier "${verifierName}" (${newDeploymentId}) status: ${latest.status}`)
    );
    nextPrintedStatus = latest.status;
  }
  if (latest.status === 'SUCCESS') {
    return { done: true, lastPrintedStatus: nextPrintedStatus };
  }
  if (latest.status === 'NEEDS_APPROVAL') {
    throw new Error(
      `Stage 2 redeployed verifier "${verifierName}" (${env}), but the new deployment is ` +
        `awaiting approval in Railway (NEEDS_APPROVAL) — approve it in the dashboard and ` +
        `re-run stage 2 (${SAFE_RERUN_NOTE})`
    );
  }
  if (TERMINAL_BAD_STATUSES.has(latest.status)) {
    throw new Error(
      `Stage 2 redeployed verifier "${verifierName}" (${env}), but the new deployment ` +
        `reached terminal status ${latest.status} instead of SUCCESS — ${SAFE_RERUN_NOTE}`
    );
  }
  return { done: false, lastPrintedStatus: nextPrintedStatus };
}

async function triggerVerifierRedeploy(args: {
  environmentId: string;
  verifier: { id: string; name: string };
  env: RailwayEnv;
  redeploy: typeof redeployRailwayServiceReusingImageWithSource;
}): Promise<{ previousDeploymentId: string; newDeploymentId: string }> {
  const { environmentId, verifier, env, redeploy } = args;
  let sourceDeploymentId: string;
  let newDeploymentId: string;
  try {
    ({ sourceDeploymentId, newDeploymentId } = await redeploy({
      environmentId,
      serviceId: verifier.id,
      serviceName: verifier.name,
      env,
    }));
  } catch (error: unknown) {
    throw formatRedeployTriggerError(verifier.name, env, error);
  }
  console.log(
    chalk.dim(`  Redeployed "${verifier.name}" (${newDeploymentId}); waiting for SUCCESS…`)
  );
  return { previousDeploymentId: sourceDeploymentId, newDeploymentId };
}

export interface RedeployAndWaitForVerifierArgs {
  environmentId: string;
  verifier: { id: string; name: string };
  env: RailwayEnv;
  timeoutMs?: number;
  pollIntervalMs?: number;
  redeploy?: typeof redeployRailwayServiceReusingImageWithSource;
  getLatestDeployment?: typeof getRailwayServiceLatestDeployment;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Redeploy the verifier (reusing its current image) and poll until
 * `serviceInstance.latestDeployment` reports the NEW deployment id with status
 * `SUCCESS`. Throws an `Error` naming the verifier when triggering the redeploy
 * fails, when a third deployment id supersedes ours during the wait, on
 * `NEEDS_APPROVAL` or a terminal failure status (`FAILED`, `CRASHED`, `REMOVED`,
 * `SKIPPED`), after more than `MAX_CONSECUTIVE_POLL_ERRORS` consecutive poll
 * errors, or on poll timeout, before any presenter is touched.
 */
export async function redeployAndWaitForVerifier(
  args: RedeployAndWaitForVerifierArgs
): Promise<string> {
  const {
    environmentId,
    verifier,
    env,
    timeoutMs = DEFAULT_VERIFIER_WAIT_TIMEOUT_MS,
    pollIntervalMs = DEFAULT_VERIFIER_POLL_INTERVAL_MS,
    redeploy = redeployRailwayServiceReusingImageWithSource,
    getLatestDeployment = getRailwayServiceLatestDeployment,
    sleep = defaultSleep,
    now = Date.now,
  } = args;

  const { previousDeploymentId, newDeploymentId } = await triggerVerifierRedeploy({
    environmentId,
    verifier,
    env,
    redeploy,
  });

  const startMs = now();
  let consecutivePollErrors = 0;
  let lastPrintedStatus: string | undefined;

  for (;;) {
    let latest: RailwayServiceLatestDeployment | null;
    try {
      latest = await getLatestDeployment({
        environmentId,
        serviceId: verifier.id,
        env,
      });
      consecutivePollErrors = 0;
    } catch (error: unknown) {
      consecutivePollErrors += 1;
      if (consecutivePollErrors > MAX_CONSECUTIVE_POLL_ERRORS) {
        throw formatPollFailureError(verifier.name, env, consecutivePollErrors, error);
      }
      await sleep(pollIntervalMs);
      continue;
    }

    const step = evaluateNewDeploymentStatus(latest, {
      newDeploymentId,
      previousDeploymentId,
      verifierName: verifier.name,
      env,
      lastPrintedStatus,
    });
    lastPrintedStatus = step.lastPrintedStatus;
    if (step.done) {
      return newDeploymentId;
    }

    if (now() - startMs >= timeoutMs) {
      const observedStatus = describeObservedStatus(latest, newDeploymentId);
      throw new Error(
        `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for verifier ` +
          `"${verifier.name}" (${env}) redeploy to reach SUCCESS ` +
          `(last observed status: ${observedStatus}) — ${SAFE_RERUN_NOTE}`
      );
    }

    await sleep(pollIntervalMs);
  }
}

export interface AssertPresentersStillReadyArgs {
  environmentId: string;
  presenters: { id: string; name: string }[];
  env: RailwayEnv;
  getLatestDeployment?: typeof getRailwayServiceLatestDeployment;
}

/**
 * Re-check that every presenter's `serviceInstance.latestDeployment` still has
 * status `SUCCESS` immediately before redeploying presenters in stage 2 (the
 * verifier wait can run for up to the poll timeout, during which a presenter's
 * deployment status can change). Collects every non-ready presenter into one
 * `Error` rather than stopping at the first, and states accurately that the
 * verifier already restarted (unlike the preflight `assertServicesDeploymentReady`,
 * which says "Nothing was changed.").
 */
export async function assertPresentersStillReady(
  args: AssertPresentersStillReadyArgs
): Promise<void> {
  const {
    environmentId,
    presenters,
    env,
    getLatestDeployment = getRailwayServiceLatestDeployment,
  } = args;

  const notReady: string[] = [];
  for (const presenter of presenters) {
    let latest: RailwayServiceLatestDeployment | null;
    try {
      latest = await getLatestDeployment({
        environmentId,
        serviceId: presenter.id,
        env,
      });
    } catch (error: unknown) {
      throw formatPresenterReadError(presenter.name, error);
    }
    if (latest?.status !== 'SUCCESS') {
      const status = latest?.status ?? 'missing';
      notReady.push(`${presenter.name} (${status})`);
    }
  }

  if (notReady.length > 0) {
    throw new Error(
      `Stage 2 restarted the verifier and it reached SUCCESS, but presenter(s) ` +
        `${notReady.join(', ')} are no longer ready — no presenter was redeployed. ` +
        'Re-run stage 2 once they settle; it repeats the verifier redeploy and is safe ' +
        'while the dual-acceptance window is open.'
    );
  }
}
