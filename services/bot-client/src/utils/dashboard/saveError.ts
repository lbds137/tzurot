/**
 * Shared dashboard save-error handling.
 *
 * Every fetch-edit-PUT dashboard (preset, character, persona) shares two failure
 * shapes that need honest user-facing messaging:
 *
 *  - **Outcome-uncertain abort (transport kind `'timeout'`/`'network'`)** — the
 *    gateway exceeded its write budget under load (or the connection dropped) and
 *    the request aborted, even though the write frequently commits server-side a
 *    moment later. Claiming outright failure (and nudging "try again", which risks
 *    a duplicate write) is wrong; tell the user it may still be applying. A
 *    `'schema'` failure also carries `status: 0` but is NOT uncertain (the write
 *    committed), so it falls through to the genuine-rejection branch.
 *  - **Genuine HTTP rejection (4xx/5xx)** — surface the gateway's actual message
 *    so the reason is visible instead of masked behind a generic "try again".
 *    The masked-400 failure mode is exactly what hid the `avatarData` null
 *    round-trip bug behind "Failed to update character. Please try again."
 */

import type { GatewayFailureKind } from '@tzurot/clients';

/** Conservative limit — leaves room for the "❌ " prefix and Discord's 2000-char cap */
const MAX_DISCORD_CONTENT = 1800;

/**
 * Notice shown when a dashboard write aborts client-side (transport status 0).
 * Reused across dashboards so the honest "may still be applying" wording stays
 * consistent. The **🔄 Refresh** label must stay in sync with the dashboards'
 * refresh control (`buildBrowseButtons` / the dashboard refresh handlers); if
 * that button's emoji/label changes, update this notice too.
 */
export const SAVE_TIMEOUT_NOTICE =
  '⏳ This is taking longer than usual — your change may still be applying. ' +
  'Give it a moment, then tap **🔄 Refresh** to confirm before saving again.';

/**
 * Error thrown by dashboard writes, carrying the gateway response `status` and
 * the transport `kind` so the caller can tell a genuine rejection (HTTP 4xx/5xx)
 * apart from an outcome-uncertain client-side abort (`'timeout'`/`'network'`).
 *
 * `kind` is what `isSaveTimeout` keys on — `status: 0` alone is ambiguous because
 * a `'schema'` failure (gateway returned 200 OK but the response body didn't
 * parse — the write DID commit) also carries `status: 0`, yet is NOT uncertain.
 */
export class DashboardUpdateError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind: GatewayFailureKind
  ) {
    super(message);
    this.name = 'DashboardUpdateError';
  }
}

/**
 * Extract the user-facing message from a gateway error.
 *
 * Gateway write errors follow the format "Failed to X <resource>: HTTP_STATUS -
 * api_message". This extracts the api_message portion for display. Returns null
 * for network errors (status 0 has a single-digit status that doesn't match the
 * 3-digit pattern) or unexpected formats, signaling callers to use a generic
 * fallback. Truncates to Discord's content limit to avoid silent send failures.
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
  return msg.length > MAX_DISCORD_CONTENT ? msg.slice(0, MAX_DISCORD_CONTENT) + '…' : msg;
}

/**
 * True when the error is a dashboard write whose server-side outcome is genuinely
 * UNCERTAIN — a client-side `'timeout'` or `'network'` abort (the write may have
 * committed before the connection dropped). Deliberately NOT keyed on `status: 0`:
 * a `'schema'` failure also has `status: 0` but the write definitively committed
 * (the gateway returned 200 OK; only the read-back body failed to parse), so the
 * "may still be applying" notice would be a lie there.
 */
export function isSaveTimeout(error: unknown): boolean {
  return (
    error instanceof DashboardUpdateError && (error.kind === 'timeout' || error.kind === 'network')
  );
}

/**
 * Build the user-facing content for a failed dashboard save:
 *  - status-0 abort (network/timeout) → the honest "may still be applying" notice
 *  - genuine HTTP rejection → the extracted gateway message
 *  - anything else → a generic per-resource failure
 *
 * @param error    the caught error
 * @param resource the resource noun for the generic fallback, e.g. 'character'
 */
export function buildDashboardSaveErrorContent(error: unknown, resource: string): string {
  if (isSaveTimeout(error)) {
    return SAVE_TIMEOUT_NOTICE;
  }
  return `❌ ${extractApiErrorMessage(error) ?? `Failed to update ${resource}. Please try again.`}`;
}
