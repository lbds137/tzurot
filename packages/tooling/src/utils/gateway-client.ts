/**
 * Build a service-auth `ServiceClient` for an environment's api-gateway.
 *
 * Most ops commands talk to the database directly (`getPrismaForEnv`). Some
 * can't: work whose logic lives BEHIND the gateway — the retention cohort
 * predicate, and later the account purge, whose off-DB cleanup (avatar unlink,
 * Redis eviction, cache broadcast) only the gateway can perform. Re-deriving
 * that logic in the CLI would fork it; calling the gateway keeps one
 * implementation.
 *
 * Credentials come from the same place the gateway itself gets them — the
 * Railway service variables — so there is nothing extra for an operator to
 * configure. Note it must be the PUBLIC url: `*.railway.internal` resolves only
 * inside Railway's network, never from a developer machine.
 */

import { execFileSync } from 'child_process';
import chalk from 'chalk';
import { ServiceClient } from '@tzurot/clients';
import { type Environment, getRailwayEnvName } from './env-runner.js';

/** The Railway service that serves the internal API. */
const GATEWAY_SERVICE = 'api-gateway';

/**
 * Read the variables set on a Railway service. Wraps the CLI/parse failure in
 * an actionable message (mirrors `getRailwayDatabaseUrl`): the raw failure here
 * is a child_process error whose most common cause — "not logged in" — is
 * invisible in the default output.
 */
function readServiceVariables(env: Environment, service: string): Record<string, string> {
  try {
    // execFileSync with ARRAY args — never string interpolation (shell-injection).
    const output = execFileSync(
      'railway',
      ['variables', '--environment', getRailwayEnvName(env), '--service', service, '--json'],
      { stdio: 'pipe', encoding: 'utf-8' }
    );
    return JSON.parse(output) as Record<string, string>;
  } catch (error) {
    throw new Error(
      `Failed to read Railway variables for the ${service} service in ${getRailwayEnvName(env)}: ` +
        `${error instanceof Error ? error.message : 'Unknown error'}. ` +
        'Check that the Railway CLI is logged in (`railway whoami`) and linked to this project.',
      { cause: error }
    );
  }
}

function requireVar(vars: Record<string, string>, keys: string[], env: Environment): string {
  for (const key of keys) {
    const value = vars[key];
    if (value !== undefined && value.length > 0) {
      return value;
    }
  }
  throw new Error(
    `${keys.join(' / ')} not set on the ${GATEWAY_SERVICE} service in Railway ${getRailwayEnvName(env)}. ` +
      `Set it in the Railway dashboard (or check you're linked to the right project).`
  );
}

/**
 * A `ServiceClient` pointed at the given environment's gateway.
 *
 * `local` reads the ambient env (the repo `.env` the CLI already loads);
 * `dev`/`prod` read the gateway service's Railway variables. Throws with an
 * actionable message naming the missing variable rather than failing later as
 * an opaque 401/ENOTFOUND.
 */
export function getServiceClientForEnv(env: Environment): ServiceClient {
  if (env === 'local') {
    const baseUrl = process.env.PUBLIC_GATEWAY_URL ?? process.env.GATEWAY_URL;
    const serviceSecret = process.env.INTERNAL_SERVICE_SECRET;
    if (baseUrl === undefined || baseUrl.length === 0) {
      throw new Error(
        'PUBLIC_GATEWAY_URL (or GATEWAY_URL) not set — is the local gateway running?'
      );
    }
    if (serviceSecret === undefined || serviceSecret.length === 0) {
      throw new Error('INTERNAL_SERVICE_SECRET not set in your local environment');
    }
    return new ServiceClient({ baseUrl, serviceSecret });
  }

  console.log(chalk.dim(`Fetching gateway credentials from Railway ${getRailwayEnvName(env)}...`));
  const vars = readServiceVariables(env, GATEWAY_SERVICE);
  // RAILWAY_PUBLIC_DOMAIN is the bare host, so it needs the scheme prepended;
  // PUBLIC_GATEWAY_URL is already a full url and is preferred.
  const publicUrl = vars.PUBLIC_GATEWAY_URL;
  const baseUrl =
    publicUrl !== undefined && publicUrl.length > 0
      ? publicUrl
      : `https://${requireVar(vars, ['RAILWAY_PUBLIC_DOMAIN'], env)}`;

  return new ServiceClient({
    baseUrl,
    serviceSecret: requireVar(vars, ['INTERNAL_SERVICE_SECRET'], env),
  });
}
