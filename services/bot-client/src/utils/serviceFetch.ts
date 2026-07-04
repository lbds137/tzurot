/**
 * Service-secret fetch helper for INFRASTRUCTURE URLs.
 *
 * Scoped narrowly: this is the ONLY legitimate non-typed-client fetch path
 * in bot-client. It exists for endpoints that live outside the
 * `/api/internal/*`, `/api/admin/*`, `/api/user/*` audience-scoped mounts —
 * specifically `/health` and `/metrics`, which are infrastructure paths
 * consumed by Railway health checks and observability tooling. Their URLs
 * are part of the deployment contract (changing them would require updating
 * the Railway / monitoring config), so they intentionally do NOT live in
 * the route manifest.
 *
 * Every other bot-client → api-gateway call MUST go through the typed
 * clients (`ServiceClient`, `OwnerClient`, `UserClient`) minted via
 * `clientsFor(interaction)`. Adding a new caller to this helper requires
 * the same justification as adding a route to the manifest: the URL must
 * be infrastructure (not RPC), and its path must be load-bearing for
 * external tooling.
 */

import { getConfig } from '@tzurot/common-types/config/config';
import { getValidatedServiceSecret } from '../startup.js';

/**
 * Allow-list of paths this helper may fetch. Enforced at COMPILE TIME via the
 * `InfraPath` parameter type, and again at runtime (defense in depth: catches
 * `as never` / `as InfraPath` casts that bypass the type at a call site).
 */
export type InfraPath = '/health' | '/metrics';
const ALLOWED_PATHS: ReadonlySet<InfraPath> = new Set<InfraPath>(['/health', '/metrics']);

/** Default timeout for infrastructure fetches (10s — matches the DEFERRED gateway budget) */
const SERVICE_FETCH_TIMEOUT_MS = 10_000;

/**
 * Fetch an infrastructure endpoint with the service-secret header attached.
 *
 * @param path - Must be one of `InfraPath`. TypeScript catches non-allow-list
 *   paths at compile time; the runtime check below catches `as` casts.
 * @throws if `path` is not in the allow-list or GATEWAY_URL is missing.
 */
export async function serviceFetch(path: InfraPath): Promise<Response> {
  if (!ALLOWED_PATHS.has(path)) {
    throw new Error(
      `serviceFetch: path "${path}" is not in the infrastructure allow-list. ` +
        `Use the typed clients (clientsFor) for RPC calls; widen InfraPath only ` +
        `if you've added a new genuine infrastructure endpoint.`
    );
  }

  const config = getConfig();
  const gatewayUrl = config.GATEWAY_URL;
  if (!gatewayUrl) {
    // `!` (not `length === 0`) catches empty + hypothetical undefined from misconfigured startup
    throw new Error('GATEWAY_URL is not configured');
  }

  return fetch(`${gatewayUrl}${path}`, {
    headers: {
      'X-Service-Auth': getValidatedServiceSecret(),
    },
    signal: AbortSignal.timeout(SERVICE_FETCH_TIMEOUT_MS),
  });
}
