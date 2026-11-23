/**
 * Stage 1 (stage) of the staged BYOK encryption-key rotation in rotation.ts.
 *
 * Purpose: no rotation step leaves a live process unable to decrypt a row another
 * live process can write. Both services read and write encrypted rows, so the
 * new key must be decrypt-live in EVERY process before ANY process encrypts with
 * it. The order is:
 *   1. refusals (an open window, a malformed CURRENT), the readiness preflight, and
 *      the check that each service's running image decrypts with NEXT;
 *   2. prepare: stage a decrypt-only `API_KEY_ENCRYPTION_KEY_NEXT` on both
 *      services (reusing an equal-on-both valid one left by an interrupted run,
 *      otherwise minting a fresh one; nothing encrypts under NEXT, so replacing
 *      it is safe);
 *   3. redeploy each service in turn and wait for the superseded deployment to
 *      report a not-live status (REMOVED, SKIPPED or FAILED), so no process from
 *      before the redeploy is still live; a deployment that stays CRASHED counts
 *      as live and must be removed in the Railway dashboard;
 *      then, before the swap, refuse unless every other deployment of each
 *      service is REMOVED, SKIPPED or FAILED (the new deployment is the only
 *      live one), because an older deployment that is still live runs with
 *      CURRENT and no NEXT, and cannot decrypt rows written after the swap;
 *   4. re-read the keys (the waits take minutes) and refuse if they moved;
 *   5. swap, all with `skipDeploys`: PREVIOUS = old CURRENT on both services,
 *      then CURRENT = the NEXT value on both, then delete NEXT on both;
 *   6. redeploy both services; stage 2 then re-encrypts the rows.
 *
 * CHECKED before the first write: stage 1 reads each service's live deployment
 * commit and refuses unless that commit's common-types `encryption.ts` reads NEXT
 * (`checkDeployedCodeDecryptsWithNext`). The commit must be in the local clone, so
 * run `git fetch origin` first. The prepare redeploy reuses the running image, so a
 * refusal means deploying that code to the environment and re-running stage 1.
 *
 * Probed on dev: the `deployment(id:)` status query (see
 * `deployment/railway-deployment-status.ts`) returned the requested ids with
 * SUCCESS, SKIPPED and REMOVED, the last for a superseded deployment. Not pinned
 * by a test: that a redeploy picks up variables staged with `skipDeploys` (both
 * services log `byokNextKeySet` at startup, so a rotation can confirm it), and
 * how soon a superseded deployment reaches REMOVED (within a few seconds in two
 * dev observations). The removal wait fails closed on the latter.
 *
 * Key values never reach a log or an error string; only service names, ids and
 * counts do.
 */

import crypto from 'node:crypto';
import chalk from 'chalk';
import { parseEncryptionKeyMaterial } from '@tzurot/common-types/utils/encryption';
import {
  requireRailwayApiToken,
  type assertRailwayServiceDeploymentReady,
  type deleteRailwayVariable,
  type redeployRailwayServiceReusingImageWithSource,
  type upsertRailwayVariable,
} from '../deployment/railway-api.js';
import { effectiveNext } from './byok-consistency.js';
import {
  assertByokServicesDeploymentReady,
  BYOK_SERVICES,
  CURRENT_VAR,
  GATEWAY_SERVICE,
  NEXT_VAR,
  PREVIOUS_VAR,
  stageRedeployFailureMessage,
  stageUpsertFailureError,
  type ByokServiceIds,
  type StageUpsertPhase,
} from './byok-stage-helpers.js';
import type { listRailwayLiveDeploymentIds } from '../deployment/railway-deployment-status.js';
import type { checkDeployedCodeDecryptsWithNext } from './deployed-code-gate.js';
import type { waitForDeploymentRemoved } from './deployment-removal-wait.js';
import type { RedeployFailure } from './redeploy-repair-text.js';
import type { redeployAndWaitForService, RedeployWaitWording } from './service-redeploy-wait.js';

type Env = 'dev' | 'prod';

/** Refusal vocabulary for the stage-1 prepare redeploys: CURRENT is unchanged and no row was touched. */
const BYOK_PREPARE_WORDING: RedeployWaitWording = {
  noun: 'service',
  stage: 'BYOK stage 1',
  rerunNote: ({ service }) =>
    `${CURRENT_VAR} has not changed and no row has been touched; wait for the service's latest deployment to settle, ` +
    `then re-run BYOK stage 1 (it reuses ${NEXT_VAR}), and if a deployment settles to FAILED, CRASHED, REMOVED or ` +
    `SKIPPED, fix ${service} in the Railway dashboard until its latest deployment is SUCCESS first.`,
  shortRerunNote: ({ service }) =>
    `${CURRENT_VAR} has not changed and no row has been touched; re-run BYOK stage 1 (it reuses ${NEXT_VAR}), and if the latest ` +
    `deployment settles to FAILED, CRASHED, REMOVED or SKIPPED, fix ${service} in the Railway dashboard until its latest deployment is SUCCESS first`,
  terminalRecovery: ({ service }) =>
    `${CURRENT_VAR} has not changed and no row has been touched. That deployment is now ${service}'s latest deployment, so BYOK stage 1 refuses to run until it is fixed: ` +
    `fix ${service} in the Railway dashboard until its latest deployment is SUCCESS, then re-run BYOK stage 1 (it reuses ${NEXT_VAR}).`,
};

const REMOVAL_RERUN_NOTE =
  `${CURRENT_VAR} has not changed and no row has been touched; once that deployment shows REMOVED, SKIPPED or FAILED in the Railway dashboard ` +
  `(a deployment that stays CRASHED counts as live and must be removed in the Railway dashboard first), re-run BYOK stage 1 (it reuses ${NEXT_VAR}). If the status read keeps failing, stop re-running (each re-run restarts the service) and take the abort path in ENCRYPTION_KEY_ROTATION.md.`;

export interface StageByokWindowDeps {
  env: Env;
  getServiceVariable: (env: Env, service: string, key: string) => string;
  getServiceVariableOrEmpty: (env: Env, service: string, key: string) => string;
  resolveByokIds: (env: Env) => ByokServiceIds;
  assertServiceDeploymentReady: typeof assertRailwayServiceDeploymentReady;
  upsertVariable: typeof upsertRailwayVariable;
  deleteVariable: typeof deleteRailwayVariable;
  redeployAndWait: typeof redeployAndWaitForService;
  redeployWithSource: typeof redeployRailwayServiceReusingImageWithSource;
  waitForDeploymentRemoved: typeof waitForDeploymentRemoved;
  listLiveDeploymentIds: typeof listRailwayLiveDeploymentIds;
  checkDeployedCode: typeof checkDeployedCodeDecryptsWithNext;
  redeployServices: (
    env: Env,
    ids: ByokServiceIds,
    buildFailureMessage: (failures: RedeployFailure[]) => string
  ) => Promise<void>;
}

/** Whether a value is usable key material. The value and the parse error stay out of every message. */
function isValidKeyMaterial(value: string): boolean {
  try {
    parseEncryptionKeyMaterial(value, NEXT_VAR);
    return true;
  } catch {
    return false;
  }
}

/**
 * Refuse unless each service's live deployment commit decrypts with NEXT. Both
 * services are checked before refusing, so one run names every stale image.
 * Runs before the first write, so a refusal leaves CURRENT and every row untouched.
 */
async function assertImagesDecryptWithNext(
  deps: StageByokWindowDeps,
  ids: ByokServiceIds
): Promise<void> {
  const { env, checkDeployedCode } = deps;
  const failures: string[] = [];
  for (const svc of BYOK_SERVICES) {
    const result = await checkDeployedCode({
      environmentId: ids[svc].environmentId,
      serviceId: ids[svc].serviceId,
      serviceName: svc,
      env,
    });
    if (result.ok) {
      console.log(
        chalk.green(
          `  ${svc} (${env}) runs ${result.commit.slice(0, 12)}, which decrypts with ${NEXT_VAR}`
        )
      );
    } else {
      // One trailing period is stripped so the joined reasons do not read "...retry.; ...".
      failures.push(`${svc}: ${result.reason.replace(/\.$/, '')}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `${failures.join('; ')}. ${CURRENT_VAR} has not changed and nothing was written.`
    );
  }
}

/** Upsert `name = value` on both services in order, each failure mapped to its phase's message. */
async function upsertOnBothServices(
  deps: StageByokWindowDeps,
  ids: ByokServiceIds,
  step: { phase: StageUpsertPhase; name: string; value: string }
): Promise<void> {
  const { env, upsertVariable } = deps;
  for (const svc of BYOK_SERVICES) {
    try {
      await upsertVariable({
        ...ids[svc],
        name: step.name,
        value: step.value,
        skipDeploys: true,
        env,
      });
    } catch {
      throw stageUpsertFailureError({ env, phase: step.phase, failedService: svc });
    }
    console.log(chalk.green(`  set ${step.name} on ${svc} (${env})`));
  }
}

/**
 * Stage NEXT on both services. A NEXT that is valid and equal on both services
 * (and differs from CURRENT) is reused; anything else is replaced by a fresh key.
 */
async function prepareNextKey(
  deps: StageByokWindowDeps,
  ids: ByokServiceIds,
  current: string
): Promise<string> {
  const { env, getServiceVariableOrEmpty } = deps;
  const [gatewayNext, workerNext] = BYOK_SERVICES.map(svc =>
    effectiveNext(current, getServiceVariableOrEmpty(env, svc, NEXT_VAR))
  );
  const reusable =
    gatewayNext !== '' && gatewayNext === workerNext && isValidKeyMaterial(gatewayNext);
  const next = reusable ? gatewayNext : crypto.randomBytes(32).toString('hex');
  console.log(
    chalk.dim(
      reusable
        ? `  reusing the staged ${NEXT_VAR} found on both services (${env})`
        : `  generated a fresh ${NEXT_VAR} (${env})`
    )
  );
  await upsertOnBothServices(deps, ids, { phase: 'next', name: NEXT_VAR, value: next });
  return next;
}

type DeploymentIdByService = Record<(typeof BYOK_SERVICES)[number], string>;

/**
 * Redeploy each service in turn, then wait for the deployment it superseded to
 * report a not-live status (the removal wait's terminal set, shared with the
 * pre-swap check). A missing source or new deployment id fails closed. Returns the
 * new deployment id of each service, for the pre-swap live-deployment check.
 */
async function redeployAndDrain(
  deps: StageByokWindowDeps,
  ids: ByokServiceIds
): Promise<DeploymentIdByService> {
  const { env, redeployAndWait, redeployWithSource, waitForDeploymentRemoved } = deps;
  const newIds: Partial<DeploymentIdByService> = {};
  for (const svc of BYOK_SERVICES) {
    // An object slot, not a `let`: TypeScript narrows a closure-assigned `let` to `undefined`.
    const superseded: { id?: string } = {};
    const created: { id?: string } = {};
    await redeployAndWait({
      environmentId: ids[svc].environmentId,
      service: { id: ids[svc].serviceId, name: svc },
      env,
      wording: BYOK_PREPARE_WORDING,
      redeploy: async args => {
        const result = await redeployWithSource(args);
        superseded.id = result.sourceDeploymentId;
        created.id = result.newDeploymentId;
        return result;
      },
    });
    if (superseded.id === undefined) {
      throw new Error(
        `The redeploy of ${svc} (${env}) did not report the deployment it superseded, so its removal cannot be awaited — ${CURRENT_VAR} has not changed and no row has been touched; re-run BYOK stage 1 (it reuses ${NEXT_VAR}).`
      );
    }
    if (created.id === undefined) {
      throw new Error(
        `The redeploy of ${svc} (${env}) did not report its new deployment, so the pre-swap live-deployment check cannot name it — ${CURRENT_VAR} has not changed and no row has been touched; re-run BYOK stage 1 (it reuses ${NEXT_VAR}).`
      );
    }
    newIds[svc] = created.id;
    await waitForDeploymentRemoved({
      deploymentId: superseded.id,
      serviceName: svc,
      env,
      rerunNote: REMOVAL_RERUN_NOTE,
    });
  }
  // Every service was visited above, and each visit either set its slot or threw.
  return newIds as DeploymentIdByService;
}

/**
 * Before the swap, refuse unless each service's ONLY live deployment is the one
 * this run redeployed. The drain waits only on the deployment each redeploy
 * superseded, so an older deployment that is still live (an auto-deploy's
 * predecessor still in its overlap, say) would keep running with CURRENT and no
 * NEXT after the swap, and could not decrypt rows written under the new key. A
 * failed or empty list fails closed.
 */
async function assertOnlyNewDeploymentsLive(
  deps: StageByokWindowDeps,
  ids: ByokServiceIds,
  newIds: DeploymentIdByService
): Promise<void> {
  const { env, listLiveDeploymentIds } = deps;
  for (const svc of BYOK_SERVICES) {
    const expected = newIds[svc];
    let live: string[];
    try {
      live = await listLiveDeploymentIds({
        serviceId: ids[svc].serviceId,
        environmentId: ids[svc].environmentId,
        env,
      });
    } catch {
      throw new Error(
        `Could not list the live deployments of ${svc} (${env}) before the swap — ${CURRENT_VAR} has not changed and no row has been touched; re-run BYOK stage 1 (it reuses ${NEXT_VAR}) once the Railway API answers.`
      );
    }
    if (live.length !== 1 || live[0] !== expected) {
      const liveList = live.length === 0 ? 'none' : live.join(', ');
      throw new Error(
        `${svc} (${env}) has live deployments other than the one this run redeployed (${expected}); live now: ${liveList}. ` +
          `${CURRENT_VAR} has not changed and no row has been touched. Wait until every deployment other than ${expected} shows REMOVED, SKIPPED or FAILED in the Railway dashboard (a deployment that stays CRASHED counts as live and must be removed there first), ` +
          `then re-run BYOK stage 1 (it reuses ${NEXT_VAR}). If a newer deployment of ${svc} started after this run's redeploy (an auto-deploy, say), simply re-run BYOK stage 1.`
      );
    }
  }
}

type PreviousByService = Record<(typeof BYOK_SERVICES)[number], string>;

/**
 * PREVIOUS as each service holds it at the start. Each service is compared against
 * its own snapshot, because a service's raw PREVIOUS may differ from the gateway's
 * and still be accepted (byok-consistency.ts normalizes it before comparing).
 */
function snapshotPrevious(deps: StageByokWindowDeps): PreviousByService {
  const { env, getServiceVariableOrEmpty } = deps;
  return {
    [GATEWAY_SERVICE]: getServiceVariableOrEmpty(env, GATEWAY_SERVICE, PREVIOUS_VAR),
    'ai-worker': getServiceVariableOrEmpty(env, 'ai-worker', PREVIOUS_VAR),
  };
}

/** The waits take minutes: refuse to swap if any key variable moved while they ran. */
function assertKeysUnchanged(
  deps: StageByokWindowDeps,
  before: { current: string; previous: PreviousByService; next: string }
): void {
  const { env, getServiceVariableOrEmpty } = deps;
  const moved = BYOK_SERVICES.some(
    svc =>
      getServiceVariableOrEmpty(env, svc, PREVIOUS_VAR) !== before.previous[svc] ||
      getServiceVariableOrEmpty(env, svc, CURRENT_VAR) !== before.current ||
      getServiceVariableOrEmpty(env, svc, NEXT_VAR) !== before.next
  );
  if (moved) {
    throw new Error(
      `The rotation keys changed in Railway while BYOK stage 1 waited for the redeploys — ${CURRENT_VAR} has not changed and no row has been touched; re-run BYOK stage 1, which re-reads them.`
    );
  }
}

/**
 * Write PREVIOUS = old CURRENT on both services before CURRENT = next on either,
 * so intermediate states still decrypt existing rows and the primary key does
 * not advance ahead of its fallback; pinned in rotation.test.ts. NEXT is deleted
 * last: a leftover NEXT equals CURRENT and is harmless.
 */
async function swapToNext(
  deps: StageByokWindowDeps,
  ids: ByokServiceIds,
  keys: { current: string; next: string }
): Promise<void> {
  const { env, deleteVariable } = deps;
  await upsertOnBothServices(deps, ids, {
    phase: 'previous',
    name: PREVIOUS_VAR,
    value: keys.current,
  });
  await upsertOnBothServices(deps, ids, { phase: 'current', name: CURRENT_VAR, value: keys.next });
  for (const svc of BYOK_SERVICES) {
    try {
      await deleteVariable({ ...ids[svc], name: NEXT_VAR, env });
    } catch {
      throw stageUpsertFailureError({ env, phase: 'delete-next', failedService: svc });
    }
    console.log(chalk.green(`  deleted ${NEXT_VAR} on ${svc} (${env})`));
  }
}

export async function stageByokWindow(deps: StageByokWindowDeps): Promise<void> {
  const {
    env,
    getServiceVariable,
    getServiceVariableOrEmpty,
    resolveByokIds,
    assertServiceDeploymentReady,
    redeployServices,
  } = deps;

  requireRailwayApiToken(env);

  // A second stage-1 while a real window is open (PREVIOUS set and distinct
  // from CURRENT) would demote the CURRENT key to PREVIOUS and DISCARD the
  // original previous key — permanently orphaning rows still encrypted under
  // it. When PREVIOUS equals CURRENT, an earlier stage-1 run stopped after
  // writing PREVIOUS on both services and before writing a new CURRENT (a
  // degenerate window), so stage 1 proceeds; pinned in rotation.test.ts.
  const current = getServiceVariable(env, GATEWAY_SERVICE, CURRENT_VAR);
  // The gateway-only read is enough: assertByokServicesConsistent has already refused a normalised PREVIOUS mismatch between the services.
  const previous = getServiceVariableOrEmpty(env, GATEWAY_SERVICE, PREVIOUS_VAR);
  const previousByService = snapshotPrevious(deps);
  if (previous !== '' && previous !== current) {
    throw new Error(
      'A rotation window is already open (PREVIOUS is set) — run stage 2 then stage 3 to close it before starting a new rotation.' +
        ` If stage 1 itself was interrupted after its writes, run stage 2 once both services' latest deployments have settled: it redeploys both services itself and waits for each to reach SUCCESS. If a service's latest deployment is FAILED, CRASHED, REMOVED or SKIPPED, fix it in the Railway dashboard until its latest deployment is SUCCESS first, because stage 2's readiness check refuses it (\`pnpm ops deploy:redeploy\` refuses it too).`
    );
  }
  parseEncryptionKeyMaterial(current, CURRENT_VAR); // sanity before touching anything

  const ids = resolveByokIds(env);
  await assertByokServicesDeploymentReady(env, ids, assertServiceDeploymentReady);
  await assertImagesDecryptWithNext(deps, ids);

  const next = await prepareNextKey(deps, ids, current);
  const newIds = await redeployAndDrain(deps, ids);
  await assertOnlyNewDeploymentsLive(deps, ids, newIds);
  assertKeysUnchanged(deps, { current, previous: previousByService, next });
  await swapToNext(deps, ids, { current, next });

  await redeployServices(env, ids, failures =>
    stageRedeployFailureMessage(failures.map(f => f.name).join(', '))
  );

  console.log(
    chalk.cyan(
      '\nStage 1 complete. Both services now hold current+previous keys, and the new key was staged on both and each pre-staging deployment reported a not-live status (REMOVED, SKIPPED or FAILED) before either encrypted with it (both running images were checked to decrypt with NEXT); redeploys requested (image reused, no rebuild).\n' +
        'Once both redeploys have settled (stage 2 refuses a deployment still in flight), run stage 2 (reencrypt): it redeploys both services again and waits for each new deployment to reach SUCCESS before touching any row.'
    )
  );
}
