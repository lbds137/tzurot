/**
 * Stage 2 (reencrypt) of the staged BYOK encryption-key rotation in rotation.ts.
 *
 * Re-encrypting rows while a service still holds only the old key orphans those
 * rows for that service. Stage 1 writes both keys with `skipDeploys: true` and
 * then redeploys; if stage 1 is interrupted between the writes and the redeploys,
 * each service's latest deployment is still the SUCCESS pre-rotation one, which
 * the readiness preflight cannot tell apart from a finished stage 1.
 *
 * So stage 2 redeploys api-gateway and then ai-worker itself, one at a time, and
 * waits for each to report the NEW deployment id at SUCCESS before any row is
 * touched. Order: window refusals, readiness preflight, redeploy-and-wait per
 * service, a re-read of both keys, then the injected re-encrypt and verify sweep.
 * A refusal or a failed wait ends the stage before any row changes.
 *
 * The two waits can take minutes, so once both have finished the stage reads the
 * keys from api-gateway a second time and refuses if either differs from the
 * first read, then asserts again that the two services agree on both keys. The
 * sweep therefore only runs on keys api-gateway still reported after the waits
 * and that ai-worker still matches (pinned by the `key re-read after the waits`
 * tests in `byok-reencrypt-stage.test.ts`). The checks narrow the window rather
 * than closing it: a change landing after them and before the sweep is not
 * detected.
 *
 * The window refusals stay ahead of every redeploy, so a stage 2 run with no open
 * window never restarts anything (pinned by `refuses an empty PREVIOUS before any
 * redeploy` and `refuses PREVIOUS equal to CURRENT before any redeploy` in
 * `byok-reencrypt-stage.test.ts`). That is what makes a re-run safe to repeat while
 * the window is open: a re-run restarts each service once more and repeats the
 * sweep, where rows already on the current key are tallied as already current.
 *
 * Precondition: the caller has already asserted that both services agree on
 * CURRENT and PREVIOUS (`assertByokServicesConsistent` in `rotation.ts`, pinned by
 * `every stage refuses on split-brain key vars between the two services` in
 * `rotation.test.ts`). This stage reads api-gateway's copy of the keys, and calls
 * the injected assertion once more after the waits.
 *
 * Not verified against live Railway: that a deployment created after the stage-1
 * writes reads both keys at deploy time, which is why the first service's
 * readiness is not re-asserted once the second wait finishes. This is inferred
 * from how Railway builds a deployment's environment, not probed.
 *
 * Key values never reach a log or an error string; only service names, ids and
 * counts do.
 */

import { parseEncryptionKeyMaterial } from '@tzurot/common-types/utils/encryption';
import type { assertRailwayServiceDeploymentReady } from '../deployment/railway-api.js';
import {
  assertByokServicesDeploymentReady,
  BYOK_SERVICES,
  CURRENT_VAR,
  GATEWAY_SERVICE,
  PREVIOUS_VAR,
  type ByokServiceIds,
} from './byok-stage-helpers.js';
import type { redeployAndWaitForService, RedeployWaitWording } from './service-redeploy-wait.js';

/** Refusal vocabulary for BYOK stage 2: no presenters, no dual-acceptance window. */
export const BYOK_REDEPLOY_WORDING: RedeployWaitWording = {
  noun: 'service',
  stage: 'BYOK stage 2',
  rerunNote: ({ service }) =>
    "no row has been re-encrypted; wait for the service's latest deployment to settle, " +
    'then re-run BYOK stage 2, and if a deployment settles to FAILED, CRASHED, REMOVED or ' +
    `SKIPPED, fix ${service} in the Railway dashboard until its latest deployment is SUCCESS first.`,
  shortRerunNote: ({ service }) =>
    'no row has been re-encrypted; if the latest deployment settles to FAILED, CRASHED, ' +
    `REMOVED or SKIPPED, fix ${service} in the Railway dashboard until its latest deployment is SUCCESS first`,
  // A terminal deployment becomes the service's latest, which the readiness
  // preflight (`assertRailwayServiceDeploymentReady`) refuses on any re-run, and
  // `deploy:redeploy` needs a SUCCESS latest deployment too, so the repair is
  // fixing the service in the Railway dashboard.
  terminalRecovery: ({ service }) =>
    `no row has been re-encrypted. That deployment is now ${service}'s latest deployment, so BYOK stage 2 refuses to run until it is fixed, and ` +
    '`pnpm ops deploy:redeploy` refuses it too (it also needs a SUCCESS latest deployment): ' +
    `fix ${service} in the Railway dashboard until its latest deployment is SUCCESS, then re-run BYOK stage 2.`,
};

export interface ByokReencryptStageDeps {
  env: 'dev' | 'prod';
  getServiceVariable: (env: 'dev' | 'prod', service: string, key: string) => string;
  getServiceVariableOrEmpty: (env: 'dev' | 'prod', service: string, key: string) => string;
  resolveByokIds: (env: 'dev' | 'prod') => ByokServiceIds;
  assertServiceDeploymentReady: typeof assertRailwayServiceDeploymentReady;
  redeployAndWait: typeof redeployAndWaitForService;
  /** Throws when the two BYOK services disagree on CURRENT or PREVIOUS. */
  assertServicesConsistent: (env: 'dev' | 'prod') => void;
  /** Re-encrypt every row still on the previous key, then run the verify sweep. */
  reencryptAndVerify: (currentKey: Buffer, previousKey: Buffer) => Promise<void>;
}

export async function reencryptByokRows(deps: ByokReencryptStageDeps): Promise<void> {
  const {
    env,
    getServiceVariable,
    getServiceVariableOrEmpty,
    resolveByokIds,
    assertServiceDeploymentReady,
    redeployAndWait,
    assertServicesConsistent,
    reencryptAndVerify,
  } = deps;

  const currentRaw = getServiceVariable(env, GATEWAY_SERVICE, CURRENT_VAR);
  const currentKey = parseEncryptionKeyMaterial(currentRaw, CURRENT_VAR);
  const previousRaw = getServiceVariableOrEmpty(env, GATEWAY_SERVICE, PREVIOUS_VAR);
  if (previousRaw === '') {
    throw new Error('No rotation window is open (PREVIOUS is empty) — run stage 1 first.');
  }
  if (previousRaw === currentRaw) {
    throw new Error('PREVIOUS equals CURRENT (an interrupted stage 1). Re-run stage 1.');
  }
  const previousKey = parseEncryptionKeyMaterial(previousRaw, PREVIOUS_VAR);

  const ids = resolveByokIds(env);
  await assertByokServicesDeploymentReady(env, ids, assertServiceDeploymentReady);

  // Sequential on purpose: one service restarts at a time, and a failed wait on
  // the first service never reaches the second.
  for (const svc of BYOK_SERVICES) {
    await redeployAndWait({
      environmentId: ids[svc].environmentId,
      service: { id: ids[svc].serviceId, name: svc },
      env,
      wording: BYOK_REDEPLOY_WORDING,
    });
  }

  // The waits take minutes, so the keys read above could be stale by now; the
  // sweep only runs on keys api-gateway still reports after both waits. The
  // re-read is absent-tolerant so a deleted variable gets the same refusal as a
  // changed one.
  if (
    getServiceVariableOrEmpty(env, GATEWAY_SERVICE, CURRENT_VAR) !== currentRaw ||
    getServiceVariableOrEmpty(env, GATEWAY_SERVICE, PREVIOUS_VAR) !== previousRaw
  ) {
    throw new Error(
      'The rotation keys changed in Railway while BYOK stage 2 waited for the redeploys — no row has been re-encrypted; re-run BYOK stage 2, which re-reads them.'
    );
  }
  // The re-read above covers api-gateway's copy only; this catches ai-worker drifting.
  assertServicesConsistent(env);

  await reencryptAndVerify(currentKey, previousKey);
}
