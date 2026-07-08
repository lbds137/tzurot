/**
 * Shared dashboard save-error handling — a thin adapter over the ux/catalog
 * outcome-honesty classifier (`classifyGatewayFailure`):
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
 *
 * Dashboard writes throw `GatewayApiError` (from `@tzurot/clients`) carrying
 * the transport `kind` + `status`; the classifier narrows it directly.
 */

import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';

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
