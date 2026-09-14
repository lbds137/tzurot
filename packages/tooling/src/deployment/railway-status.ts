/**
 * Resolve the project/environment/service ids the Railway public GraphQL API
 * needs, from `railway status --json` — the CLI's own view of the linked
 * project, which already carries every id the GraphQL mutations require.
 */

import { execFileSync } from 'node:child_process';
import { z } from 'zod';

import { UsageError } from '../utils/errors.js';
import { getRailwayEnvName } from '../utils/env-runner.js';

/** A hung CLI — network stall, an unexpected prompt — otherwise blocks the operator indefinitely. */
const RAILWAY_STATUS_TIMEOUT_MS = 30_000;

/**
 * Only the fields this module reads. `passthrough()` so unrelated fields on
 * the real `railway status --json` payload (volumes, workspace,
 * serviceInstances, ...) never break this schema.
 */
const RailwayStatusSchema = z
  .object({
    id: z.string(),
    environments: z.object({
      edges: z.array(
        z.object({
          node: z.object({ id: z.string(), name: z.string() }).passthrough(),
        })
      ),
    }),
    services: z.object({
      edges: z.array(
        z.object({
          node: z.object({ id: z.string(), name: z.string() }).passthrough(),
        })
      ),
    }),
  })
  .passthrough();

export interface RailwayIds {
  projectId: string;
  environmentId: string;
  serviceId?: string;
}

export interface RailwayServiceList {
  projectId: string;
  environmentId: string;
  services: { id: string; name: string }[];
}

function fetchRailwayStatus(): unknown {
  let raw: string;
  try {
    raw = execFileSync('railway', ['status', '--json'], {
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: RAILWAY_STATUS_TIMEOUT_MS,
    });
  } catch (error) {
    throw new UsageError(
      `Failed to run "railway status --json" — is this checkout linked to a Railway project? ` +
        `Run "railway link" in the repo root. (${error instanceof Error ? error.message : 'unknown error'})`
    );
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new UsageError('"railway status --json" did not return valid JSON');
  }
}

type RailwayStatus = z.infer<typeof RailwayStatusSchema>;

/**
 * Parse the raw `railway status --json` payload and locate the environment
 * node for `env` — the shape-check and environment-lookup logic every caller
 * needs, single-sourced so `resolveRailwayIds` and `listRailwayServices`
 * throw byte-identical "unexpected shape" and "environment not found"
 * errors.
 */
function parseStatusAndFindEnvironment(env: 'dev' | 'prod'): {
  status: RailwayStatus;
  environmentNode: { id: string; name: string };
} {
  const raw = fetchRailwayStatus();

  const parsed = RailwayStatusSchema.safeParse(raw);
  if (!parsed.success) {
    const paths = parsed.error.issues.map(issue => issue.path.join('.')).join(', ');
    throw new UsageError(
      `"railway status --json" returned an unexpected shape (the Railway CLI ` +
        `output format may have changed) — problem field(s): ${paths}`
    );
  }
  const status = parsed.data;

  const railwayEnvName = getRailwayEnvName(env);
  const environmentNode = status.environments.edges.find(
    edge => edge.node.name === railwayEnvName
  )?.node;
  if (environmentNode === undefined) {
    const names = status.environments.edges.map(edge => edge.node.name).join(', ');
    throw new UsageError(
      `Railway environment "${railwayEnvName}" not found. Environments present: ${names}`
    );
  }

  return { status, environmentNode };
}

/** Resolve the project, environment, and (optional) service ids for `env`/`service`. */
export function resolveRailwayIds(env: 'dev' | 'prod', service: string | null): RailwayIds {
  const { status, environmentNode } = parseStatusAndFindEnvironment(env);

  if (service === null) {
    return { projectId: status.id, environmentId: environmentNode.id };
  }

  const serviceNode = status.services.edges.find(edge => edge.node.name === service)?.node;
  if (serviceNode === undefined) {
    const names = status.services.edges.map(edge => edge.node.name).join(', ');
    throw new UsageError(`Railway service "${service}" not found. Services present: ${names}`);
  }

  return { projectId: status.id, environmentId: environmentNode.id, serviceId: serviceNode.id };
}

/**
 * List every service in the project/environment for `env`, with ids —
 * so a caller can derive which services inherit a shared variable without
 * hardcoding the service set.
 */
export function listRailwayServices(env: 'dev' | 'prod'): RailwayServiceList {
  const { status, environmentNode } = parseStatusAndFindEnvironment(env);

  return {
    projectId: status.id,
    environmentId: environmentNode.id,
    services: status.services.edges.map(edge => ({ id: edge.node.id, name: edge.node.name })),
  };
}
