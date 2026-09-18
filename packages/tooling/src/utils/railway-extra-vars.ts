/**
 * Resolve extra Railway variables for `pnpm ops run --with <NAME[,NAME]>`.
 *
 * The read targets the SHARED (project) tier only — `resolveRailwayIds(env,
 * null)` — never a specific service's scope, since the whole point of this
 * flag is a script that needs a project-wide secret (an API key, a shared
 * token) without the operator handling the value by hand.
 *
 * VALUE SAFETY: the map this module returns holds SECRETS. It is handed to
 * the caller and nothing else — never printed, logged, or interpolated into
 * an error message. Only variable NAMES may ever appear in output.
 */

import { readRailwayVariableValue } from '../deployment/railway-api.js';
import { resolveRailwayIds } from '../deployment/railway-status.js';
import { UsageError } from './errors.js';

/**
 * Parse cac's raw value for a repeated-or-single `--with` flag into a
 * de-duplicated, trimmed list of variable names.
 *
 * cac hands back `undefined` when the flag is absent, a `string` when it was
 * passed once, or a `string[]` when it was passed more than once — each
 * element (single or repeated) may itself be a comma-separated list.
 */
export function parseWithVarNames(raw: string | string[] | undefined): string[] {
  const rawEntries = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];

  const seen = new Set<string>();
  const names: string[] = [];
  for (const entry of rawEntries) {
    for (const candidate of entry.split(',')) {
      const name = candidate.trim();
      if (name.length === 0 || seen.has(name)) {
        continue;
      }
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

/**
 * Resolve `names` to their SHARED-tier values for `env`. An empty `names`
 * list short-circuits with no Railway call at all — no `resolveRailwayIds`,
 * no network — so `--with` left unset costs nothing. A name whose value
 * comes back `undefined` (absent from the shared tier) is a hard failure:
 * the thrown `UsageError` names the MISSING variable and the environment,
 * never any value — including the value of a sibling name that DID resolve.
 */
export async function resolveExtraRailwayVars(
  env: 'dev' | 'prod',
  names: string[]
): Promise<Record<string, string>> {
  if (names.length === 0) {
    return {};
  }

  const { projectId, environmentId } = resolveRailwayIds(env, null);

  const entries = await Promise.all(
    names.map(async name => {
      const value = await readRailwayVariableValue({ projectId, environmentId, name, env });
      return [name, value] as const;
    })
  );

  const result: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (value === undefined) {
      throw new UsageError(
        `--with requested Railway variable "${name}", which is not set in the ${env} ` +
          'environment (shared/project tier).'
      );
    }
    result[name] = value;
  }
  return result;
}
