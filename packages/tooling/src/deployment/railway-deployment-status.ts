/**
 * Read Railway deployment status: one deployment by id, or the live deployments of
 * one service.
 *
 * Probed read-only against the dev Railway API: `deployment(id:)` returns `{ id,
 * status }`, and a superseded deployment reports `REMOVED`. The list query
 * `deployments(input:)` with a `status: { notIn: [...] }` filter was probed the same
 * way: the server applies the filter, and the same query with `status: { in:
 * ["REMOVED"] }` returned the REMOVED deployments. The BYOK stage-1 removal wait and
 * the pre-swap live-deployment check both fail closed on any error or shape
 * mismatch from these queries. Kept out of `railway-api.ts` (at its line budget);
 * it reuses that module's `railwayGraphql` transport.
 */

import { z } from 'zod';
import { railwayGraphql, type RailwayEnv } from './railway-api.js';

const DEPLOYMENT_STATUS_QUERY = `
  query DeploymentStatus($id: String!) {
    deployment(id: $id) { id status }
  }
`;

const DeploymentStatusResponseSchema = z
  .object({
    deployment: z.object({ id: z.string(), status: z.string() }).passthrough(),
  })
  .passthrough();

/**
 * Deployment statuses with no running process. A deployment in one of these
 * cannot be serving traffic or decrypting rows. CRASHED is deliberately absent: a
 * restart policy can bring a crashed deployment back, so it counts as possibly
 * live.
 */
export const NOT_LIVE_STATUSES = ['REMOVED', 'SKIPPED', 'FAILED'] as const;

const LIVE_DEPLOYMENTS_QUERY = `
  query LiveDeployments($input: DeploymentListInput!) {
    deployments(input: $input, first: 10) {
      pageInfo { hasNextPage }
      edges { node { id status } }
    }
  }
`;

const LiveDeploymentsResponseSchema = z
  .object({
    deployments: z
      .object({
        pageInfo: z.object({ hasNextPage: z.boolean() }).passthrough(),
        edges: z.array(
          z.object({ node: z.object({ id: z.string(), status: z.string() }).passthrough() })
        ),
      })
      .passthrough(),
  })
  .passthrough();

/**
 * Returns the status string of the deployment `deploymentId`. Throws on a
 * transport error, an unexpected response shape (including a null deployment),
 * or a returned id that is not the requested one.
 */
export async function getRailwayDeploymentStatus(args: {
  deploymentId: string;
  env: RailwayEnv;
}): Promise<string> {
  const rawData = await railwayGraphql<unknown>(
    DEPLOYMENT_STATUS_QUERY,
    { id: args.deploymentId },
    args.env
  );
  const parsed = DeploymentStatusResponseSchema.safeParse(rawData);
  if (!parsed.success) {
    throw new Error('Railway API returned an unexpected shape for deployment-status');
  }
  if (parsed.data.deployment.id !== args.deploymentId) {
    throw new Error(
      'Railway API returned a different deployment than requested for deployment-status'
    );
  }
  return parsed.data.deployment.status;
}

/**
 * Returns the ids of every deployment of one service whose status is not in
 * NOT_LIVE_STATUSES. Throws on a transport error, an unexpected response shape, or
 * a result that spills past the first page (`hasNextPage` true or absent), since a
 * truncated list could hide a live deployment.
 */
export async function listRailwayLiveDeploymentIds(args: {
  serviceId: string;
  environmentId: string;
  env: RailwayEnv;
}): Promise<string[]> {
  const rawData = await railwayGraphql<unknown>(
    LIVE_DEPLOYMENTS_QUERY,
    {
      input: {
        serviceId: args.serviceId,
        environmentId: args.environmentId,
        status: { notIn: [...NOT_LIVE_STATUSES] },
      },
    },
    args.env
  );
  const parsed = LiveDeploymentsResponseSchema.safeParse(rawData);
  if (!parsed.success) {
    throw new Error('Railway API returned an unexpected shape for live-deployments');
  }
  if (parsed.data.deployments.pageInfo.hasNextPage !== false) {
    throw new Error(
      'Railway API returned more live deployments than one page for live-deployments; refusing to rely on a truncated list'
    );
  }
  // The server-side notIn above is the primary filter; this client-side pass drops any
  // not-live node the server returned anyway, so a REMOVED id can never reach the caller.
  return parsed.data.deployments.edges
    .filter(edge => !(NOT_LIVE_STATUSES as readonly string[]).includes(edge.node.status))
    .map(edge => edge.node.id);
}
