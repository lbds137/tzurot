/**
 * Minimal Railway public-API GraphQL client, for the operations the Railway
 * CLI does not expose (variable deletion is the first one).
 *
 * The seam is deliberately one generic `railwayGraphql` call plus one typed
 * wrapper per operation, so the next CLI-missing operation plugs in beside
 * `deleteRailwayVariable` without reshaping this module.
 *
 * The endpoint URL and the `variableDelete` mutation signature come from
 * Railway's public API docs (and TASK-62) — not probed here: a Railway API
 * token is a dev-machine secret that does not exist in CI or in this
 * checkout, so there is nothing to call from a test.
 *
 * No `console.*` in this file: it stays unit-testable and secret-safe.
 */

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
 * Read the Railway API token from the environment, or throw a `UsageError`
 * naming what's required. Read at CALL time (never at import time) so the
 * dotenv load in `cli.ts` has already populated `process.env`.
 */
export function requireRailwayApiToken(): string {
  const token = process.env.TZUROT_RAILWAY_API_TOKEN;
  if (token === undefined || token.length === 0) {
    throw new UsageError(
      'TZUROT_RAILWAY_API_TOKEN is not set. Mint a PROJECT-scoped token in the Railway ' +
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
 */
export async function railwayGraphql<T>(
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const token = requireRailwayApiToken();

  let response: Response;
  try {
    response = await fetch(RAILWAY_GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
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
}

interface VariableDeleteResponse {
  variableDelete: boolean;
}

/**
 * Delete one Railway environment variable via the public GraphQL API.
 *
 * `serviceId` is spread in conditionally rather than assigned as
 * `serviceId: args.serviceId` so the key is entirely absent from `input` for
 * a shared (project-level) delete, rather than depending on how an
 * `undefined` value happens to serialize — pinned by the "omits the
 * serviceId key entirely" case in `railway-api.test.ts`, which asserts
 * `Object.hasOwn(input, 'serviceId') === false`. Per Railway's public API
 * docs and TASK-62 (not probed here, per the module doc above), a shared
 * variable is expected to be identified by omitting `serviceId` rather than
 * sending it as null.
 */
export async function deleteRailwayVariable(args: DeleteRailwayVariableArgs): Promise<void> {
  const input = {
    projectId: args.projectId,
    environmentId: args.environmentId,
    ...(args.serviceId === undefined ? {} : { serviceId: args.serviceId }),
    name: args.name,
  };

  const data = await railwayGraphql<VariableDeleteResponse>(VARIABLE_DELETE_MUTATION, { input });

  if (!data.variableDelete) {
    throw new Error(`Railway rejected the delete for variable "${args.name}"`);
  }
}
