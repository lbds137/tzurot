/**
 * Minimal Railway public-API GraphQL client, for the operations the Railway
 * CLI does not expose (variable deletion is the first one).
 *
 * The seam is deliberately one generic `railwayGraphql` call plus one typed
 * wrapper per operation, so the next CLI-missing operation plugs in beside
 * `deleteRailwayVariable` without reshaping this module.
 *
 * The endpoint URL, the `Project-Access-Token` auth header, and the
 * `variableDelete` request/response shapes are observed from a live call
 * against the real API with a project-scoped token — not
 * from Railway's docs, which describe a Bearer-token account-scoped auth
 * header that a project-scoped token cannot use (it comes back HTTP 200 with
 * a GraphQL `Not Authorized` error). There is still nothing to call from a
 * test: a Railway API token is a dev-machine secret that does not exist in
 * CI or in this checkout.
 *
 * Every call is env-scoped: the Railway dashboard mints project-scoped
 * tokens PER ENVIRONMENT, so `requireRailwayApiToken`/`railwayGraphql` take a
 * `RailwayEnv` and select `TZUROT_RAILWAY_API_TOKEN_DEV` or `_PROD`
 * accordingly — there is no unsuffixed fallback.
 *
 * No `console.*` in this file: it stays unit-testable and secret-safe.
 */

import { z } from 'zod';

import { UsageError } from '../utils/errors.js';

const RAILWAY_GRAPHQL_ENDPOINT = 'https://backboard.railway.app/graphql/v2';

/** A hung network call otherwise blocks the operator indefinitely. */
const RAILWAY_API_TIMEOUT_MS = 30_000;

const VARIABLE_DELETE_MUTATION = `
  mutation VariableDelete($input: VariableDeleteInput!) {
    variableDelete(input: $input)
  }
`;

interface GraphqlResponseBody<T> {
  data?: T;
  errors?: { message?: string }[];
}

/**
 * The Railway dashboard mints project-scoped API tokens PER ENVIRONMENT —
 * one for `development`, one for `production` — so a single token cannot
 * authenticate calls against both.
 */
export type RailwayEnv = 'dev' | 'prod';

const RAILWAY_API_TOKEN_ENV_VAR: Record<RailwayEnv, string> = {
  dev: 'TZUROT_RAILWAY_API_TOKEN_DEV',
  prod: 'TZUROT_RAILWAY_API_TOKEN_PROD',
};

/**
 * Read the env-scoped Railway API token, or throw a `UsageError` naming the
 * specific missing variable. Read at CALL time (never at import time) so the
 * dotenv load in `cli.ts` has already populated `process.env`. There is no
 * fallback to an unsuffixed variable name: a dev token must never be able to
 * authenticate a prod call.
 */
export function requireRailwayApiToken(env: RailwayEnv): string {
  const varName = RAILWAY_API_TOKEN_ENV_VAR[env];
  const token = process.env[varName];
  if (token === undefined || token.length === 0) {
    throw new UsageError(
      `${varName} is not set. Mint a PROJECT-scoped token for this environment in the Railway ` +
        'dashboard (Project Settings → Tokens) and add it to your local .env.'
    );
  }
  return token;
}

/**
 * POST one GraphQL operation to Railway's public API and return its `data`.
 *
 * Throws `UsageError` when the token is missing (before any network call),
 * and a plain `Error` for every other failure (bad HTTP status, GraphQL
 * `errors`, or a response with no `data`) — none of these are messages the
 * operator can fix by retyping a flag. No error path here includes the
 * token, the request body, or the request headers.
 *
 * The body is parsed BEFORE the `response.ok` check, so a non-2xx response
 * that carries GraphQL `errors` reports Railway's specific message instead
 * of just the HTTP status.
 *
 * Takes the ENVIRONMENT, never the token value, and reads the token itself
 * via `requireRailwayApiToken` — the secret never appears in a caller's
 * scope or in a signature a stack trace or log line could render.
 *
 * Authenticates via the `Project-Access-Token` header — a project-scoped
 * token is rejected under a Bearer-token header (HTTP 200 with a GraphQL
 * `Not Authorized` error, observed live).
 */
export async function railwayGraphql<T>(
  query: string,
  variables: Record<string, unknown>,
  env: RailwayEnv
): Promise<T> {
  const token = requireRailwayApiToken(env);

  let response: Response;
  try {
    response = await fetch(RAILWAY_GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Project-Access-Token': token,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(RAILWAY_API_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      throw new Error('Railway API request timed out after 30s', { cause: error });
    }
    throw error;
  }

  let body: GraphqlResponseBody<T>;
  try {
    body = (await response.json()) as GraphqlResponseBody<T>;
  } catch {
    throw new Error(`Railway API returned a non-JSON body (status ${response.status})`);
  }

  if (body.errors !== undefined && body.errors !== null && body.errors.length > 0) {
    const messages = body.errors.map(e => e.message ?? '(no message)').join('; ');
    throw new Error(`Railway API returned errors (status ${response.status}): ${messages}`);
  }

  if (!response.ok) {
    throw new Error(`Railway API request failed: ${response.status} ${response.statusText}`);
  }

  // The body is an unchecked cast over parsed JSON: a spec-compliant server may send `data: null`.
  if (body.data === undefined || body.data === null) {
    throw new Error('Railway API response carried no data');
  }

  return body.data;
}

export interface DeleteRailwayVariableArgs {
  projectId: string;
  environmentId: string;
  /** Omitted for a shared (project-level) variable. */
  serviceId?: string;
  name: string;
  /** Selects which env-suffixed API token authenticates the call. */
  env: RailwayEnv;
}

/**
 * Only the field this module reads, required and boolean-typed. A missing
 * field or a non-boolean value is a SHAPE change (the mutation's return
 * type evolved) rather than a rejection, and is reported as one — a scalar
 * `variableDelete` becoming e.g. `{ id: "…" }` must not be misread as
 * Railway saying no. `passthrough()` so any other field Railway's response
 * carries rides along unvalidated rather than tripping the parse.
 */
const VariableDeleteResponseSchema = z.object({ variableDelete: z.boolean() }).passthrough();

/**
 * Delete one Railway environment variable via the public GraphQL API.
 *
 * `serviceId` is spread in conditionally rather than assigned as
 * `serviceId: args.serviceId` so the key is entirely absent from `input` for
 * a shared (project-level) delete, rather than depending on how an
 * `undefined` value happens to serialize — pinned by the "omits the
 * serviceId key entirely" case in `railway-api.test.ts`, which asserts
 * `Object.hasOwn(input, 'serviceId') === false`. Observed live: omitting
 * `serviceId` addresses the shared (project-level) tier, and the mutation
 * returns a bare boolean.
 */
export async function deleteRailwayVariable(args: DeleteRailwayVariableArgs): Promise<void> {
  const input = {
    projectId: args.projectId,
    environmentId: args.environmentId,
    ...(args.serviceId === undefined ? {} : { serviceId: args.serviceId }),
    name: args.name,
  };

  const rawData = await railwayGraphql<unknown>(VARIABLE_DELETE_MUTATION, { input }, args.env);

  // Never include the raw response body in this error: any Railway payload can carry a secret.
  const parsed = VariableDeleteResponseSchema.safeParse(rawData);
  if (!parsed.success) {
    throw new Error(
      'Railway API returned an unexpected shape for a variable-delete response ' +
        '(the mutation return type may have changed)'
    );
  }

  if (parsed.data.variableDelete === false) {
    throw new Error(`Railway rejected the delete for variable "${args.name}"`);
  }
}
