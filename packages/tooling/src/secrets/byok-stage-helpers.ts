/**
 * Stage-1 helpers for the staged BYOK encryption-key rotation in rotation.ts:
 * ordered variable writes (PREVIOUS on both services before CURRENT on both)
 * and state-specific repair messages that omit error causes and key values.
 * Stage 2 (byok-reencrypt-stage.ts) redeploys both services itself, so these
 * messages send the operator to stage 2 rather than to a hand redeploy; a service
 * whose latest deployment failed is fixed in the Railway dashboard first.
 */

import crypto from 'node:crypto';
import chalk from 'chalk';
import { parseEncryptionKeyMaterial } from '@tzurot/common-types/utils/encryption';
import {
  requireRailwayApiToken,
  type assertRailwayServiceDeploymentReady,
  type upsertRailwayVariable,
} from '../deployment/railway-api.js';
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

export type ByokServiceIds = Record<(typeof BYOK_SERVICES)[number], Required<RailwayIds>>;
export type StageUpsertPhase = 'previous' | 'current';

export function stageUpsertFailureError(args: {
  env: 'dev' | 'prod';
  phase: StageUpsertPhase;
  failedService: string;
}): Error {
  const { env, phase, failedService } = args;
  const suffix = ' No stored row has been touched; stage 2 has not run.';

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

export interface StageByokWindowDeps {
  env: 'dev' | 'prod';
  getServiceVariable: (env: 'dev' | 'prod', service: string, key: string) => string;
  getServiceVariableOrEmpty: (env: 'dev' | 'prod', service: string, key: string) => string;
  resolveByokIds: (env: 'dev' | 'prod') => ByokServiceIds;
  assertServiceDeploymentReady: typeof assertRailwayServiceDeploymentReady;
  upsertVariable: typeof upsertRailwayVariable;
  redeployServices: (
    env: 'dev' | 'prod',
    ids: ByokServiceIds,
    buildFailureMessage: (failures: RedeployFailure[]) => string
  ) => Promise<void>;
}

export async function stageByokWindow(deps: StageByokWindowDeps): Promise<void> {
  const {
    env,
    getServiceVariable,
    getServiceVariableOrEmpty,
    resolveByokIds,
    assertServiceDeploymentReady,
    upsertVariable,
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
  const previous = getServiceVariableOrEmpty(env, GATEWAY_SERVICE, PREVIOUS_VAR);
  if (previous !== '' && previous !== current) {
    throw new Error(
      'A rotation window is already open (PREVIOUS is set) — run stage 2 then stage 3 to close it before starting a new rotation.' +
        ` If stage 1 itself was interrupted after its writes, run stage 2 once both services' latest deployments have settled: it redeploys both services itself and waits for each to reach SUCCESS. If a service's latest deployment is FAILED, CRASHED, REMOVED or SKIPPED, fix it in the Railway dashboard until its latest deployment is SUCCESS first, because stage 2's readiness check refuses it (\`pnpm ops deploy:redeploy\` refuses it too).`
    );
  }
  parseEncryptionKeyMaterial(current, CURRENT_VAR); // sanity before touching anything

  const ids = resolveByokIds(env);
  await assertByokServicesDeploymentReady(env, ids, assertServiceDeploymentReady);
  const next = crypto.randomBytes(32).toString('hex');

  // Write PREVIOUS = current on both services before writing CURRENT = next on
  // either, so intermediate states still decrypt existing rows and the primary
  // key does not advance ahead of its fallback; pinned in rotation.test.ts.
  for (const { phase, name, value } of [
    { phase: 'previous' as const, name: PREVIOUS_VAR, value: current },
    { phase: 'current' as const, name: CURRENT_VAR, value: next },
  ]) {
    for (const svc of BYOK_SERVICES) {
      try {
        await upsertVariable({
          ...ids[svc],
          name,
          value,
          skipDeploys: true,
          env,
        });
      } catch {
        throw stageUpsertFailureError({
          env,
          phase,
          failedService: svc,
        });
      }
      console.log(chalk.green(`  set ${name} on ${svc} (${env})`));
    }
  }

  await redeployServices(env, ids, failures =>
    stageRedeployFailureMessage(failures.map(f => f.name).join(', '))
  );

  console.log(
    chalk.cyan(
      '\nStage 1 complete. Both services now hold current+previous keys; redeploys requested (image reused, no rebuild).\n' +
        'Once both redeploys have settled (stage 2 refuses a deployment still in flight), run stage 2 (reencrypt): it redeploys both services again and waits for each new deployment to reach SUCCESS before touching any row.'
    )
  );
}
