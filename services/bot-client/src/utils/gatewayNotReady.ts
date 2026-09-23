/**
 * Classifies a `GatewayResult` failure as "the gateway is not ready yet"
 * rather than a real error.
 *
 * "Not ready" means the gateway is mid-deploy: either the container is still
 * booting the OLD build, which doesn't have a brand-new route yet (surfaces
 * as a 404), or Railway is rolling the container over between builds, which
 * surfaces as a transport-level failure (no connection to accept the socket,
 * or the request timing out) rather than any HTTP response at all. A 502,
 * 503, or 504 from a reverse proxy in front of a gateway that hasn't started
 * accepting connections yet reads the same way.
 *
 * Caller contract: a 404 is only evidence of "not ready" for a route that
 * NEVER answers 404 on its own — so this can only be interpreted as the
 * gateway's unmatched-route handler, not the route's own logic. A caller
 * whose route can legitimately 404 (e.g. a lookup-by-id endpoint) must not
 * use this helper to classify that route's failures.
 *
 * Not the general transient-failure check — see `isRetryableGatewayFailure` (gatewayRetry.ts), which retries every 5xx including 500.
 */

import type { GatewayResult } from '@tzurot/clients';

type GatewayFailure = Extract<GatewayResult<unknown>, { ok: false }>;

/** HTTP statuses consistent with the gateway being mid-deploy or mid-rollover. */
const NOT_READY_HTTP_STATUSES: ReadonlySet<number> = new Set([404, 502, 503, 504]);

export function isGatewayNotReadyFailure(failure: GatewayFailure): boolean {
  if (failure.kind === 'network' || failure.kind === 'timeout') {
    return true;
  }
  return failure.kind === 'http' && NOT_READY_HTTP_STATUSES.has(failure.status);
}
