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
import { ServiceClient, UserClient, asActor } from '@tzurot/clients';
import { type Environment, getRailwayEnvName } from './env-runner.js';

/** The Railway service that serves the internal API. */
const GATEWAY_SERVICE = 'api-gateway';

/**
 * Discord snowflake shape (17-20 digits). `asUser` must already have been
 * read from raw argv by the caller (`rawOptionValue`, never cac's parsed
 * options — see that helper's own header comment for why an all-digit flag
 * value can't survive cac's numeric coercion); this just bounds the shape.
 */
const SNOWFLAKE_PATTERN = /^\d{17,20}$/;

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

/** The gateway credentials shared by every gateway-backed client constructor. */
export interface GatewayCredentials {
  baseUrl: string;
  serviceSecret: string;
  /** Undefined when the environment has no BOT_OWNER_ID set (not fatal on its
   *  own — only `getUserClientForEnv` requires it, and only absent `--as-user`). */
  botOwnerId: string | undefined;
}

/**
 * Resolve the gateway's base URL, service secret, and bot-owner id for an
 * environment.
 *
 * `local` reads the ambient env (the repo `.env` the CLI already loads);
 * `dev`/`prod` read the gateway service's Railway variables. Throws with an
 * actionable message naming the missing variable rather than failing later as
 * an opaque 401/ENOTFOUND.
 */
function getGatewayCredentialsForEnv(env: Environment): GatewayCredentials {
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
    const botOwnerId = process.env.BOT_OWNER_ID;
    return {
      baseUrl,
      serviceSecret,
      botOwnerId: botOwnerId !== undefined && botOwnerId.length > 0 ? botOwnerId : undefined,
    };
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

  return {
    baseUrl,
    serviceSecret: requireVar(vars, ['INTERNAL_SERVICE_SECRET'], env),
    botOwnerId:
      vars.BOT_OWNER_ID !== undefined && vars.BOT_OWNER_ID.length > 0
        ? vars.BOT_OWNER_ID
        : undefined,
  };
}

/**
 * A `ServiceClient` pointed at the given environment's gateway.
 */
export function getServiceClientForEnv(env: Environment): ServiceClient {
  const { baseUrl, serviceSecret } = getGatewayCredentialsForEnv(env);
  return new ServiceClient({ baseUrl, serviceSecret });
}

/**
 * Resolve the service client for a CLI command, reporting failure the way a
 * command should: a red one-liner and a nonzero exit code, not an unhandled
 * rejection. Returns null when the caller should stop.
 *
 * Credential resolution genuinely fails in normal operation (Railway CLI not
 * logged in, a missing variable), so every gateway-backed command needs this
 * same guard — extracted so they cannot drift into handling it differently.
 */
export function resolveServiceClientOrExit(env: Environment): ServiceClient | null {
  try {
    return getServiceClientForEnv(env);
  } catch (error) {
    console.error(chalk.red(`\n${error instanceof Error ? error.message : 'Unknown error'}`));
    process.exitCode = 1;
    return null;
  }
}

/**
 * A `UserClient` acting as the bot owner (default) or an explicit
 * `--as-user` Discord id, pointed at the given environment's gateway.
 *
 * The synthesized `GatewayUser` sends the acting id as username/displayName
 * rather than a real profile: `UserService`'s placeholder-username upgrade
 * (`packages/identity/src/UserService.ts`) only overwrites a stored username
 * that still equals the row's discordId (the shell-provisioning placeholder),
 * so sending the id back as the username can never clobber a real stored
 * username — the provisioning upgrade path is simply never triggered by this
 * synthetic context.
 *
 * @throws Error naming BOT_OWNER_ID when `asUser` is omitted and the
 *   environment has none configured, or when `asUser` isn't a Discord
 *   snowflake (17-20 digits).
 */
export function getUserClientForEnv(
  env: Environment,
  asUser?: string
): { client: UserClient; actingDiscordId: string; isBotOwner: boolean } {
  if (asUser !== undefined && !SNOWFLAKE_PATTERN.test(asUser)) {
    throw new Error(`--as-user must be a Discord snowflake (17-20 digits), got: "${asUser}"`);
  }

  const credentials = getGatewayCredentialsForEnv(env);

  const actingDiscordId = asUser ?? credentials.botOwnerId;
  if (actingDiscordId === undefined) {
    const where =
      env === 'local'
        ? 'your local environment'
        : `the ${GATEWAY_SERVICE} service in Railway ${getRailwayEnvName(env)}`;
    throw new Error(
      `BOT_OWNER_ID not set in ${where} and no --as-user was given. ` +
        'Pass --as-user <discordId>, or set BOT_OWNER_ID.'
    );
  }

  const client = new UserClient({
    baseUrl: credentials.baseUrl,
    serviceSecret: credentials.serviceSecret,
    actor: asActor(actingDiscordId),
    user: {
      discordId: actingDiscordId,
      username: actingDiscordId,
      displayName: actingDiscordId,
      isBot: false,
    },
  });

  return {
    client,
    actingDiscordId,
    // Compares the acting id to BOT_OWNER_ID on purpose: an explicit
    // --as-user equal to the owner id counts as the owner, same as the
    // default (no --as-user) path above.
    isBotOwner: actingDiscordId === credentials.botOwnerId,
  };
}
