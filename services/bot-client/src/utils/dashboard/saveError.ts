/**
 * Shared dashboard save-error handling — now a thin adapter over the ux/catalog
 * outcome-honesty classifier (`classifyGatewayFailure`), which generalizes this
 * module's original dispatcher to every gateway write:
 *
 *  - **Outcome-uncertain abort (transport kind `'timeout'`/`'network'`)** — the
 *    write frequently commits server-side a moment later; claiming failure (and
 *    nudging "try again", which risks a duplicate write) is wrong.
 *  - **Committed-unconfirmed (kind `'schema'`)** — the gateway returned 200 OK,
 *    only the read-back body failed to parse; "saved, refresh to verify".
 *  - **Genuine HTTP rejection (4xx/5xx)** — surface the gateway's actual message
 *    so the reason is visible instead of masked behind a generic "try again".
 *    The masked-400 failure mode is exactly what hid the `avatarData` null
 *    round-trip bug behind "Failed to update character. Please try again."
 */

import { GatewayApiError, type GatewayFailureKind } from '@tzurot/clients';
import { classifyGatewayFailure, MAX_SURFACED_LENGTH } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';

/**
 * Error thrown by dashboard writes, carrying the gateway response `status` and
 * the transport `kind` so a genuine rejection (HTTP 4xx/5xx) is distinguishable
 * from an outcome-uncertain client-side abort (`'timeout'`/`'network'`).
 *
 * Extends `GatewayApiError` so the ux/catalog classifier narrows it with zero
 * special-casing. TRANSITIONAL: full retirement onto plain `GatewayApiError`
 * (updating the five dashboard api.ts throw sites) lands with the substrate
 * migration PR; new code should throw `GatewayApiError` directly.
 */
export class DashboardUpdateError extends GatewayApiError {
  constructor(message: string, status: number, kind: GatewayFailureKind) {
    super(message, status, kind);
    this.name = 'DashboardUpdateError';
  }
}

/**
 * Extract the user-facing message from a gateway error.
 *
 * Gateway write errors follow the format "Failed to X <resource>: HTTP_STATUS -
 * api_message". This extracts the api_message portion for display. Returns null
 * for non-HTTP failure modes (timeout/network/schema/config all carry status 0,
 * whose single digit doesn't match the 3-digit pattern) or unexpected formats,
 * signaling callers to use a generic fallback. Truncates to Discord's content
 * limit to avoid silent send failures.
 */
export function extractApiErrorMessage(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }
  const match = /: \d{3} - (.+)$/.exec(error.message);
  if (match?.[1] === undefined) {
    return null;
  }
  const msg = match[1];
  return msg.length > MAX_SURFACED_LENGTH ? msg.slice(0, MAX_SURFACED_LENGTH) + '…' : msg;
}

/**
 * Build the user-facing content for a failed dashboard save. Delegates to the
 * ux/catalog classifier — outcome classification is a function of the error,
 * never a call-site choice — with the dashboard **🔄 Refresh** affordance named
 * in the uncertain/unconfirmed shapes (dashboards have a refresh control; keep
 * the label in sync with the refresh handlers if its emoji/label changes).
 *
 * @param error    the caught error
 * @param resource the resource noun, e.g. 'character'
 */
export function buildDashboardSaveErrorContent(error: unknown, resource: string): string {
  return renderSpec(classifyGatewayFailure(error, resource, { refreshAffordance: true }));
}
