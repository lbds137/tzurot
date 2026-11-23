/**
 * Shared helpers for the staged BYOK encryption-key rotation in rotation.ts:
 * the service/variable constants, state-specific repair messages for stage 1's
 * ordered variable writes and stage 3's redeploys (all omit error causes and key
 * values), and the readiness preflight every stage runs. Stage 1's own sequence
 * lives in byok-prepare-stage.ts. Stage 2 (byok-reencrypt-stage.ts) redeploys
 * both services itself, so these messages send the operator to stage 2 rather
 * than to a hand redeploy; a service whose latest deployment failed is fixed in
 * the Railway dashboard first.
 */

import type { assertRailwayServiceDeploymentReady } from '../deployment/railway-api.js';
import type { RailwayIds } from '../deployment/railway-status.js';
import {
  composeRedeployRepair,
  partitionRedeployFailures,
  type RedeployFailure,
} from './redeploy-repair-text.js';

export const GATEWAY_SERVICE = 'api-gateway';
export const BYOK_SERVICES = [GATEWAY_SERVICE, 'ai-worker'] as const;
export const CURRENT_VAR = 'API_KEY_ENCRYPTION_KEY';
export const PREVIOUS_VAR = 'API_KEY_ENCRYPTION_KEY_PREVIOUS';
export const NEXT_VAR = 'API_KEY_ENCRYPTION_KEY_NEXT';

export type ByokServiceIds = Record<(typeof BYOK_SERVICES)[number], Required<RailwayIds>>;
export type StageUpsertPhase = 'next' | 'previous' | 'current' | 'delete-next';

export function stageUpsertFailureError(args: {
  env: 'dev' | 'prod';
  phase: StageUpsertPhase;
  failedService: string;
}): Error {
  const { env, phase, failedService } = args;
  const suffix = ' No stored row has been touched; stage 2 has not run.';

  if (phase === 'next') {
    return new Error(
      `Failed to upsert ${NEXT_VAR} on ${failedService} (${env}); it may or may not have applied. Re-run stage 1, which regenerates it; ${CURRENT_VAR} has not changed.${suffix}`
    );
  }

  if (phase === 'delete-next') {
    return new Error(
      `Failed to delete ${NEXT_VAR} on ${failedService} (${env}); it may or may not have applied. Every key write landed and a leftover ${NEXT_VAR} equals ${CURRENT_VAR}, so it decrypts nothing extra: run stage 2, which redeploys both services itself and waits for each to reach SUCCESS; stage 3 deletes the leftover.${suffix}`
    );
  }

  if (phase === 'previous') {
    return new Error(
      `Failed to upsert ${PREVIOUS_VAR} on ${failedService} (${env}); it may or may not have applied. Re-run stage 1.${suffix}`
    );
  }

  return new Error(
    `Failed to upsert ${CURRENT_VAR} on ${failedService} (${env}); it may or may not have applied. Re-run stage 1, then follow what it reports: if it completes, nothing more to do; if it reports ${CURRENT_VAR} DIFFERS, copy ${CURRENT_VAR} from api-gateway to ai-worker in the Railway dashboard, then run stage 2, which redeploys both services itself and waits for each to reach SUCCESS; if it reports a rotation window is already open, every write landed: run stage 2, which redeploys both services itself.${suffix}`
  );
}

/**
 * Stage 3's failure text after the PREVIOUS delete. A failure the helper
 * refused (`RailwayRedeployRefusedError`) is sent to the dashboard first, with
 * the command only as the retry; the sentence is built by the same
 * partition/compose helpers the rotate-env paths use. `failures` is non-empty
 * (the caller returns early when nothing failed).
 */
export function finalizeRedeployFailureMessage(args: {
  env: 'dev' | 'prod';
  failures: RedeployFailure[];
}): string {
  const { env, failures } = args;
  const { refusedRepair, commands, plainNames } = partitionRedeployFailures(failures, env);
  const plainRepair = `Redeploy ${plainNames.join(', ')} with ${commands}, wait for each redeploy to reach SUCCESS`;
  const repair = composeRedeployRepair(refusedRepair, commands, plainRepair);
  const ledger = `stamp the ledger: \`pnpm ops secrets:mark-rotated byok-encryption-key --env ${env}\`.`;
  const several = failures.length > 1;
  const head =
    `${PREVIOUS_VAR} is deleted from Railway, but ${failures.map(f => f.name).join(', ')} still ` +
    `${several ? 'hold' : 'holds'} it in memory until ${several ? 'they restart' : 'it restarts'}. `;
  return `${head}${repair}, then ${ledger}`;
}

export function stageRedeployFailureMessage(failedServices: string): string {
  return (
    `Both services hold both keys in Railway, but ${failedServices} failed to redeploy and still runs its old process until redeployed. ` +
    `Run stage 2 once both services' latest deployments have settled: it redeploys both services itself and waits for each new deployment to reach SUCCESS before touching any row. ` +
    `If a service's latest deployment is FAILED, CRASHED, REMOVED or SKIPPED, fix it in the Railway dashboard until its latest deployment is SUCCESS first, because stage 2's readiness check refuses it (\`pnpm ops deploy:redeploy\` refuses it too).`
  );
}

/**
 * The shared BYOK readiness preflight: assert every BYOK service's latest
 * deployment is SUCCESS, in order, stopping at the first rejection. One loop,
 * three callers: stage 1 passes its injected `assertServiceDeploymentReady`;
 * stages 2 and 3 pass `assertRailwayServiceDeploymentReady` directly.
 */
export async function assertByokServicesDeploymentReady(
  env: 'dev' | 'prod',
  ids: ByokServiceIds,
  assertFn: typeof assertRailwayServiceDeploymentReady
): Promise<void> {
  for (const svc of BYOK_SERVICES) {
    await assertFn({
      environmentId: ids[svc].environmentId,
      serviceId: ids[svc].serviceId,
      serviceName: svc,
      env,
    });
  }
}
