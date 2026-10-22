/**
 * Stage-3 helpers for the staged BYOK encryption-key rotation in rotation.ts:
 * service-id narrowing and partial-delete repair messaging.
 */

import { resolveRailwayIds, type RailwayIds } from '../deployment/railway-status.js';

/**
 * A named service always resolves with an id (resolveRailwayIds throws when it
 * is missing), but the shared return type marks it optional; narrowing here
 * keeps an undefined id from silently turning a delete into a SHARED-scope one.
 */
export function resolveServiceIds(env: 'dev' | 'prod', service: string): Required<RailwayIds> {
  const { projectId, environmentId, serviceId } = resolveRailwayIds(env, service);
  if (serviceId === undefined) {
    throw new Error(`Railway service "${service}" resolved without a service id (${env})`);
  }
  return { projectId, environmentId, serviceId };
}

export function deleteFailureError(args: {
  env: 'dev' | 'prod';
  service: string;
  services: readonly string[];
  absentNow: readonly string[];
  varName: string;
  error: unknown;
}): Error {
  const { env, service, services, absentNow, varName, error } = args;
  if (absentNow.length === 0) {
    return new Error(
      `Failed to delete ${varName} on ${service} (${env}). Re-run stage 3 to retry; if the re-run reports that the services differ, run the deploy:var-delete command it prints, then re-run stage 3.`,
      { cause: error }
    );
  }
  const stillSet = services.filter(s => !absentNow.includes(s));
  const commands = stillSet
    .map(s => `\`pnpm ops deploy:var-delete --env ${env} --service ${s} --name ${varName} --yes\``)
    .join('; ');
  return new Error(
    `Failed to delete ${varName} on ${service} (${env}). ` +
      `It is now absent on ${absentNow.join(', ')} but may still be set on ${stillSet.join(', ')}. ` +
      `Delete it with: ${commands}, then re-run stage 3.`,
    { cause: error }
  );
}
