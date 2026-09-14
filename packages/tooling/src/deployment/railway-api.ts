/**
 * Minimal Railway public-API GraphQL client, for the operations the Railway
 * CLI does not expose: variable deletion, variable listing (names only —
 * values are secrets and are never returned), variable upsert, and
 * service-instance redeploy.
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
 * The shared "the return type may have changed" message shape for every
 * operation in this file — a Zod parse failure is reported as a SHAPE
 * change, never as a rejection, so a mutation's return type evolving from a
 * bare boolean to e.g. `{ id: "…" }` is never misread as Railway saying no.
 */
function unexpectedShapeError(operationLabel: string): Error {
  return new Error(
    `Railway API returned an unexpected shape for a ${operationLabel} response ` +
      '(the operation return type may have changed)'
  );
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
    throw unexpectedShapeError('variable-delete');
  }

  if (parsed.data.variableDelete === false) {
    throw new Error(`Railway rejected the delete for variable "${args.name}"`);
  }
}

const VARIABLES_QUERY = `
  query Variables($projectId: String!, $environmentId: String!, $serviceId: String) {
    variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
  }
`;

/**
 * Only the field this module reads: a map of variable name to value. Values
 * are typed `unknown` and never inspected — this module only ever reads the
 * KEYS off this shape, never the values. Pinned by the "returns only the
 * keys, never the fixture values" case in `railway-api.test.ts`.
 */
const VariablesResponseSchema = z
  .object({ variables: z.record(z.string(), z.unknown()) })
  .passthrough();

export interface ListRailwayVariableNamesArgs {
  projectId: string;
  environmentId: string;
  /** Omitted to read the shared (project-level) tier. */
  serviceId?: string;
  env: RailwayEnv;
}

/**
 * List the NAMES of variables visible at a scope (shared, when `serviceId`
 * is omitted, or one service's). The values are secrets — this returns
 * `Object.keys` of the response only; a value must never be returned,
 * logged, or included in an error message.
 */
export async function listRailwayVariableNames(
  args: ListRailwayVariableNamesArgs
): Promise<string[]> {
  const variables = {
    projectId: args.projectId,
    environmentId: args.environmentId,
    ...(args.serviceId === undefined ? {} : { serviceId: args.serviceId }),
  };

  const rawData = await railwayGraphql<unknown>(VARIABLES_QUERY, variables, args.env);

  const parsed = VariablesResponseSchema.safeParse(rawData);
  if (!parsed.success) {
    throw unexpectedShapeError('variables');
  }

  return Object.keys(parsed.data.variables);
}

/**
 * The value-reading sibling of `VariablesResponseSchema`, deliberately kept
 * SEPARATE rather than widening that one: `VariablesResponseSchema` types its
 * values `unknown` on purpose so reading one is a type error, and it is
 * pinned by the "returns only the keys, never the fixture values" case.
 * Widening it would silently remove that guarantee for every other caller, so
 * the one reader that genuinely needs a value gets its own schema.
 */
const VariableValuesResponseSchema = z
  .object({ variables: z.record(z.string(), z.string()) })
  .passthrough();

export interface ReadRailwayVariableValueArgs {
  projectId: string;
  environmentId: string;
  /** Omitted to read the shared (project-level) tier. */
  serviceId?: string;
  name: string;
  env: RailwayEnv;
}

/**
 * Read ONE variable's value at a scope, or `undefined` when the key is absent.
 *
 * Value safety: the returned value is a secret. It is handed to the caller and
 * nothing else — never printed, never logged, never interpolated into an error
 * message. A shape-parse failure throws `unexpectedShapeError('variables')`,
 * which carries no payload. Pinned by the "never writes the value to stdout or
 * into an error message" case in `railway-api.test.ts`.
 */
export async function readRailwayVariableValue(
  args: ReadRailwayVariableValueArgs
): Promise<string | undefined> {
  const variables = {
    projectId: args.projectId,
    environmentId: args.environmentId,
    ...(args.serviceId === undefined ? {} : { serviceId: args.serviceId }),
  };

  const rawData = await railwayGraphql<unknown>(VARIABLES_QUERY, variables, args.env);

  const parsed = VariableValuesResponseSchema.safeParse(rawData);
  if (!parsed.success) {
    throw unexpectedShapeError('variables');
  }

  return parsed.data.variables[args.name];
}

const VARIABLE_UPSERT_MUTATION = `
  mutation VariableUpsert($input: VariableUpsertInput!) {
    variableUpsert(input: $input)
  }
`;

/**
 * Only the field this module reads, required and boolean-typed — see the
 * doc comment on `VariableDeleteResponseSchema` for why this shape (rather
 * than a rejection) is how a return-type change is reported.
 */
const VariableUpsertResponseSchema = z.object({ variableUpsert: z.boolean() }).passthrough();

export interface UpsertRailwayVariableArgs {
  projectId: string;
  environmentId: string;
  /** Omitted for a shared (project-level) variable. */
  serviceId?: string;
  name: string;
  /** The secret value. Travels in the HTTPS request body — never argv, never stdout. */
  value: string;
  /**
   * `true` lets the caller own redeploy ordering instead of racing Railway's
   * implicit per-variable deploys.
   */
  skipDeploys: boolean;
  env: RailwayEnv;
}

/**
 * Upsert one Railway variable via the public GraphQL API.
 *
 * `serviceId` is spread in conditionally, exactly as in `deleteRailwayVariable`,
 * so a shared (project-level) upsert omits the key entirely rather than
 * depending on how `undefined` happens to serialize.
 *
 * This is the one operation in this file whose request body carries a secret
 * VALUE (delete and redeploy send only ids and names). `railwayGraphql`'s own
 * error path interpolates Railway's GraphQL error message verbatim, and that
 * message can echo the submitted value back in a shape we cannot reliably
 * recognise — not just verbatim, but truncated, case-shifted, or embedded in
 * some other diagnostic. A scrub keyed on recognising the value (e.g.
 * `.includes(args.value)`) is therefore incomplete by construction: it only
 * catches the shape it was written for. So this catch discards Railway's own
 * wording ENTIRELY for this operation, with exactly one exception:
 * `UsageError` is rethrown untouched, because `requireRailwayApiToken` builds
 * it from a variable NAME (never the value) and it carries the actionable
 * "set TZUROT_RAILWAY_API_TOKEN_..." message the operator needs. Every other
 * error becomes a generic message naming the operation and `args.name` (the
 * variable name is not a secret) — no Railway-supplied text, no `cause`.
 * Dropping `cause` is deliberate: Node's default uncaught-exception printer
 * renders the full `[cause]` chain, so attaching the original (Railway-worded)
 * error as `cause` would re-leak it despite the generic `.message`; losing the
 * original fetch-internals stack is the correct trade; the shape-change and
 * rejection errors below stay untouched — they never carry the value and are
 * thrown after this catch, from the parsed response.
 */
export async function upsertRailwayVariable(args: UpsertRailwayVariableArgs): Promise<void> {
  const input = {
    projectId: args.projectId,
    environmentId: args.environmentId,
    ...(args.serviceId === undefined ? {} : { serviceId: args.serviceId }),
    name: args.name,
    value: args.value,
    skipDeploys: args.skipDeploys,
  };

  let rawData: unknown;
  try {
    rawData = await railwayGraphql<unknown>(VARIABLE_UPSERT_MUTATION, { input }, args.env);
  } catch (error) {
    if (error instanceof UsageError) {
      throw error;
    }
    // Deliberately dropping `cause` and discarding Railway's own wording entirely: no
    // partial-match heuristic can reliably recognise every shape Railway might echo the
    // submitted value back in, so nothing short of a full discard is complete. Attaching the
    // original error as `cause` would also re-leak it through Node's default
    // uncaught-exception printer, which renders the full `[cause]` chain.
    // eslint-disable-next-line preserve-caught-error -- see justification above
    throw new Error(
      `Railway API upsert failed for variable "${args.name}". Railway's own error text is withheld here because it can echo the submitted value; check the Railway dashboard for the detail.`
    );
  }

  const parsed = VariableUpsertResponseSchema.safeParse(rawData);
  if (!parsed.success) {
    throw unexpectedShapeError('variable-upsert');
  }

  if (parsed.data.variableUpsert === false) {
    throw new Error(`Railway rejected the upsert for variable "${args.name}"`);
  }
}

const SERVICE_INSTANCE_REDEPLOY_MUTATION = `
  mutation ServiceInstanceRedeploy($environmentId: String!, $serviceId: String!) {
    serviceInstanceRedeploy(environmentId: $environmentId, serviceId: $serviceId)
  }
`;

/**
 * Only the field this module reads, required and boolean-typed — same shape
 * discipline as the other response schemas in this file.
 */
const ServiceInstanceRedeployResponseSchema = z
  .object({ serviceInstanceRedeploy: z.boolean() })
  .passthrough();

export interface RedeployRailwayServiceArgs {
  environmentId: string;
  serviceId: string;
  env: RailwayEnv;
}

/**
 * Redeploy one service instance via the public GraphQL API. This mutation
 * takes the environment and service ids at the top level — no input object,
 * and no deployment id — verified by live read-only schema introspection.
 */
export async function redeployRailwayService(args: RedeployRailwayServiceArgs): Promise<void> {
  const variables = { environmentId: args.environmentId, serviceId: args.serviceId };

  const rawData = await railwayGraphql<unknown>(
    SERVICE_INSTANCE_REDEPLOY_MUTATION,
    variables,
    args.env
  );

  const parsed = ServiceInstanceRedeployResponseSchema.safeParse(rawData);
  if (!parsed.success) {
    throw unexpectedShapeError('service-redeploy');
  }

  if (parsed.data.serviceInstanceRedeploy === false) {
    throw new Error(`Railway rejected the redeploy for service "${args.serviceId}"`);
  }
}

const SERVICE_INSTANCE_DEPLOYMENT_QUERY = `
  query ServiceInstanceDeployment($environmentId: String!, $serviceId: String!) {
    serviceInstance(environmentId: $environmentId, serviceId: $serviceId) {
      latestDeployment { id status meta }
    }
  }
`;

/**
 * `meta` is a Railway GraphQL SCALAR (opaque JSON) rather than a selectable
 * object type, so it arrives whole and is parsed here. Only `commitHash` is
 * required; the other keys Railway carries (`branch`, `repo`, `commitAuthor`,
 * `commitMessage`) ride along unvalidated via `passthrough`.
 *
 * `commitHash` is regex-constrained to a hex string, not just `z.string()`:
 * this value is later passed as an argv element to `git cat-file` and `git
 * grep` as a revision. It is never shell-interpolated, so this is not an
 * injection risk, but a value beginning with `-` would be read by git as a
 * FLAG rather than a revision, producing a confusing failure in place of the
 * intended "commit not in this clone" message. The length range is 7-40
 * (short SHA through full SHA) rather than exactly 40, since both `git
 * cat-file` and `git grep` accept abbreviated SHAs.
 */
const DeploymentMetaSchema = z
  .object({ commitHash: z.string().regex(/^[0-9a-f]{7,40}$/) })
  .passthrough();

const ServiceInstanceDeploymentResponseSchema = z
  .object({
    serviceInstance: z
      .object({
        latestDeployment: z
          .object({ id: z.string(), status: z.string(), meta: DeploymentMetaSchema })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

export interface GetLiveDeploymentCommitArgs {
  environmentId: string;
  serviceId: string;
  env: RailwayEnv;
}

/**
 * The commit SHA of a service instance's latest deployment, required to be
 * SUCCESS.
 *
 * Observed once, against one service in one environment: `latestDeployment`
 * returned the SUCCESS build rather than a newer SKIPPED record. That single
 * observation says nothing about how the field behaves when the latest record
 * is BUILDING or FAILED, so this throws unless `status === 'SUCCESS'` instead
 * of trusting the field's selection rule to mean "the live build". Pinned by
 * the "refuses a non-SUCCESS latestDeployment" case in `railway-api.test.ts`.
 */
export async function getLiveDeploymentCommit(args: GetLiveDeploymentCommitArgs): Promise<string> {
  const variables = { environmentId: args.environmentId, serviceId: args.serviceId };

  const rawData = await railwayGraphql<unknown>(
    SERVICE_INSTANCE_DEPLOYMENT_QUERY,
    variables,
    args.env
  );

  const parsed = ServiceInstanceDeploymentResponseSchema.safeParse(rawData);
  if (!parsed.success) {
    throw unexpectedShapeError('service-instance-deployment');
  }

  const deployment = parsed.data.serviceInstance.latestDeployment;
  if (deployment.status !== 'SUCCESS') {
    throw new Error(
      `The latest deployment for service "${args.serviceId}" is ${deployment.status}, not SUCCESS ` +
        '— its commit is not what the environment is running. Wait for the deploy to settle, then retry.'
    );
  }

  return deployment.meta.commitHash;
}
