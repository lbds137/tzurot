/**
 * Stage-3 helpers for the staged BYOK encryption-key rotation in rotation.ts:
 * window classification, finalize-window refusal messaging, service-id
 * narrowing, the per-service variable delete loop, and partial-delete repair
 * messaging.
 */

import chalk from 'chalk';
import type { deleteRailwayVariable } from '../deployment/railway-api.js';
import { resolveRailwayIds, type RailwayIds } from '../deployment/railway-status.js';
import { BYOK_SERVICES, type ByokServiceIds } from './byok-stage-helpers.js';

export type FinalizeWindowState = 'open' | 'none' | 'degenerate';

/**
 * Classify the BYOK rotation window before stage 3 touches the database or
 * deletes `API_KEY_ENCRYPTION_KEY_PREVIOUS`.
 *
 * `assertByokServicesConsistent` normalises a service's `PREVIOUS === CURRENT`
 * to `''` so stage 1 can resume an interrupted PREVIOUS-phase write without
 * tripping the split-brain check. That means stage 3 can reach here with
 * `PREVIOUS === CURRENT` on one or both services (while the other service has
 * `''` or `undefined`), so `degenerate` is checked against the RAW per-service
 * reads before `none`.
 */
export function classifyFinalizeWindow(args: {
  current: string;
  previousByService: readonly (string | undefined)[];
}): FinalizeWindowState {
  const { current, previousByService } = args;
  // finalizeByokWindow parses CURRENT first, so an empty value cannot reach it there; this check keeps the function correct when called on its own.
  if (current !== '' && previousByService.some(prev => prev === current)) {
    return 'degenerate';
  }
  if (previousByService.every(prev => prev === undefined || prev === '')) {
    return 'none';
  }
  return 'open';
}

export function assertFinalizeWindowState(args: {
  env: 'dev' | 'prod';
  resume: boolean;
  current: string;
  previousByService: readonly (string | undefined)[];
}): void {
  const { env, resume, current, previousByService } = args;
  const state = classifyFinalizeWindow({ current, previousByService });

  if (state === 'degenerate') {
    throw new Error(
      `API_KEY_ENCRYPTION_KEY_PREVIOUS still equals API_KEY_ENCRYPTION_KEY (${env}) — the key ` +
        'was never rotated (an interrupted stage 1). Re-run stage 1 ' +
        `(\`pnpm ops secrets:rotate-byok --env ${env} --stage 1\`), which resumes this state.`
    );
  }

  if (state === 'none' && !resume) {
    throw new Error(
      `No BYOK rotation window is open in ${env} (API_KEY_ENCRYPTION_KEY_PREVIOUS is not set). ` +
        `Run \`pnpm ops secrets:rotate-byok --env ${env} --stage 1\` to start a rotation, or ` +
        `\`pnpm ops secrets:rotate-byok --env ${env} --stage 3 --resume\` only if an earlier ` +
        'stage 3 was interrupted after deleting PREVIOUS.'
    );
  }

  if (state === 'open' && resume) {
    throw new Error(
      `API_KEY_ENCRYPTION_KEY_PREVIOUS is still set (${env}), so there is nothing to resume — ` +
        `run stage 3 without --resume (\`pnpm ops secrets:rotate-byok --env ${env} --stage 3\`).`
    );
  }
}

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
  /** True when PREVIOUS is already gone on every service (the NEXT cleanup after the PREVIOUS delete). */
  previousAlreadyDeleted?: boolean;
}): Error {
  const { env, service, services, absentNow, varName, error, previousAlreadyDeleted } = args;
  if (absentNow.length === 0 && previousAlreadyDeleted === true) {
    return new Error(
      `Failed to delete ${varName} on ${service} (${env}). API_KEY_ENCRYPTION_KEY_PREVIOUS is already deleted on every service; re-run stage 3 with --resume to retry.`,
      { cause: error }
    );
  }
  if (absentNow.length === 0) {
    return new Error(
      `Failed to delete ${varName} on ${service} (${env}). Re-run stage 3 to retry; if the re-run reports that the services differ, run the deploy:var-delete command it prints, then re-run stage 3 with --resume.`,
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
      `Delete it with: ${commands}, then re-run stage 3 with --resume.`,
    { cause: error }
  );
}

/**
 * Delete `varName` from every BYOK service through the Railway API (the CLI
 * rejects an empty value). A service whose variable is already absent is
 * skipped; a failed delete throws `deleteFailureError` naming what is left.
 * `previousAlreadyDeleted` marks the NEXT cleanup that runs after PREVIOUS was
 * deleted everywhere, so a first-delete failure points at `--resume`.
 */
export async function deleteByokVariable(args: {
  env: 'dev' | 'prod';
  ids: ByokServiceIds;
  varName: string;
  readRaw: (env: 'dev' | 'prod', service: string, key: string) => string | undefined;
  deleteVariable: typeof deleteRailwayVariable;
  previousAlreadyDeleted: boolean;
}): Promise<void> {
  const { env, ids, varName, readRaw, deleteVariable, previousAlreadyDeleted } = args;
  const absentNow: string[] = [];
  for (const svc of BYOK_SERVICES) {
    if (readRaw(env, svc, varName) === undefined) {
      absentNow.push(svc);
      console.log(chalk.dim(`  ${varName} already absent on ${svc} (${env})`));
      continue;
    }
    try {
      await deleteVariable({ ...ids[svc], name: varName, env });
      absentNow.push(svc);
      console.log(chalk.green(`  deleted ${varName} on ${svc} (${env})`));
    } catch (error) {
      throw deleteFailureError({
        env,
        service: svc,
        services: BYOK_SERVICES,
        absentNow,
        varName,
        error,
        previousAlreadyDeleted,
      });
    }
  }
}
