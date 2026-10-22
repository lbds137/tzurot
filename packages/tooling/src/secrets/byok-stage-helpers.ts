/**
 * Stage-1 helpers for the staged BYOK encryption-key rotation in rotation.ts:
 * ordered variable writes (PREVIOUS on both services before CURRENT on both)
 * and state-specific repair messages that omit error causes and key values.
 */

import crypto from 'node:crypto';
import chalk from 'chalk';
import { parseEncryptionKeyMaterial } from '@tzurot/common-types/utils/encryption';
import { requireRailwayApiToken, type upsertRailwayVariable } from '../deployment/railway-api.js';
import type { RailwayIds } from '../deployment/railway-status.js';

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
  okService?: string;
}): Error {
  const { env, phase, failedService, okService } = args;
  const varName = phase === 'previous' ? PREVIOUS_VAR : CURRENT_VAR;
  const prefix = `Failed to upsert ${varName} on ${failedService} (${env}). `;
  const suffix = ' No stored row has been touched; stage 2 has not run.';

  if (phase === 'previous') {
    if (okService === undefined) {
      return new Error(`${prefix}Nothing was written. Re-run stage 1.${suffix}`);
    }
    return new Error(
      `${prefix}PREVIOUS was written on ${okService} only. Delete it there with \`pnpm ops deploy:var-delete --env ${env} --service ${okService} --name ${PREVIOUS_VAR} --yes\`, then re-run stage 1.${suffix}`
    );
  }

  if (okService === undefined) {
    return new Error(
      `${prefix}Both services hold the old key as PREVIOUS and CURRENT (a degenerate window). Re-run stage 1.${suffix}`
    );
  }
  return new Error(
    `${prefix}${okService} now has the new ${CURRENT_VAR}, ${failedService} still has the old one; both have the old key as PREVIOUS. In the Railway dashboard, copy ${CURRENT_VAR} from ${okService} to ${failedService}, redeploy both services, then run stage 2.${suffix}`
  );
}

export function stageRedeployFailureMessage(failedServices: string): string {
  return (
    `Both services hold both keys in Railway, but ${failedServices} failed to redeploy and still runs its old process until redeployed. ` +
    `Redeploy ${failedServices} (Railway dashboard: the service's latest deployment → Redeploy), then run stage 2. ` +
    "(not verified: that a dashboard redeploy carries the just-written variables; check the new deployment's start time is after this run)"
  );
}

export interface StageByokWindowDeps {
  env: 'dev' | 'prod';
  getServiceVariable: (env: 'dev' | 'prod', service: string, key: string) => string;
  getServiceVariableOrEmpty: (env: 'dev' | 'prod', service: string, key: string) => string;
  resolveByokIds: (env: 'dev' | 'prod') => ByokServiceIds;
  upsertVariable: typeof upsertRailwayVariable;
  redeployServices: (
    env: 'dev' | 'prod',
    ids: ByokServiceIds,
    buildFailureMessage: (failedServices: string) => string
  ) => Promise<void>;
}

export async function stageByokWindow(deps: StageByokWindowDeps): Promise<void> {
  const {
    env,
    getServiceVariable,
    getServiceVariableOrEmpty,
    resolveByokIds,
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
      'A rotation window is already open (PREVIOUS is set) — run stage 2 then stage 3 to close it before starting a new rotation.'
    );
  }
  parseEncryptionKeyMaterial(current, CURRENT_VAR); // sanity before touching anything

  const ids = resolveByokIds(env);
  const next = crypto.randomBytes(32).toString('hex');

  // Write PREVIOUS = current on both services before writing CURRENT = next on
  // either, so intermediate states still decrypt existing rows and the primary
  // key does not advance ahead of its fallback; pinned in rotation.test.ts.
  for (const { phase, name, value } of [
    { phase: 'previous' as const, name: PREVIOUS_VAR, value: current },
    { phase: 'current' as const, name: CURRENT_VAR, value: next },
  ]) {
    let okService: string | undefined;
    for (const svc of BYOK_SERVICES) {
      try {
        await upsertVariable({
          ...ids[svc],
          name,
          value,
          skipDeploys: true,
          env,
        });
        okService = svc;
      } catch {
        throw stageUpsertFailureError({
          env,
          phase,
          failedService: svc,
          okService,
        });
      }
      if (phase === 'current') {
        console.log(chalk.green(`  set ${PREVIOUS_VAR}, ${CURRENT_VAR} on ${svc} (${env})`));
      }
    }
  }

  await redeployServices(env, ids, stageRedeployFailureMessage);

  console.log(
    chalk.cyan(
      '\nStage 1 complete. Both services now hold current+previous keys and were redeployed (image reused, no rebuild).\n' +
        'Wait for the redeploys to finish, then run stage 2 (reencrypt).'
    )
  );
}
