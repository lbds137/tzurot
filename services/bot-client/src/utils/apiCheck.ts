/**
 * Tri-state result type for gateway pre-flight checks.
 *
 * Use this for bot-client utilities that call the gateway to answer
 * a yes/no question (is this user verified? does this user have an
 * active API key?). Representing the three states explicitly —
 * known-yes, known-no, couldn't-check — forces callers to make an
 * explicit fail-open / fail-closed policy decision instead of
 * inheriting the silent "no" that a naive `result.ok && …` collapse
 * produces.
 *
 * Widening the return type of a gateway check is the structural fix for
 * the silent-fail-closed anti-pattern (a transient gateway failure
 * looking identical to "user definitively lacks the entitlement"). See
 * `BACKLOG.md` for the autocomplete-cache callsites that should still
 * adopt this pattern.
 */
export type ApiCheck<T> = { kind: 'ok'; value: T } | { kind: 'error'; error: string };

/**
 * Classify an HTTP status as transient (server-side, retryable) vs. permanent
 * (client-side, won't resolve without a caller fix).
 *
 * Used by caches that want to serve last-known-good data on transient failures
 * (5xx, network timeouts, rate limits) but NOT on permanent failures (4xx —
 * auth, not-found, bad-request) where stale data would mask a real state
 * change the user needs to see. The autocomplete cache uses this to gate its
 * stale-fallback path.
 *
 * Conventions:
 * - `status === 0` is used by our gateway client for timeouts / network
 *   errors where no HTTP response was received — treated as transient.
 * - `status === 429` (rate limit) is transient despite being in the 4xx
 *   range: rate limits self-resolve without any user action, and the user's
 *   data hasn't changed — only the server's willingness to respond has.
 *   Serving stale data through a rate-limit window is the right UX.
 */
export function isTransientHttpStatus(status: number): boolean {
  return status === 0 || status === 429 || status >= 500;
}

/**
 * Sentinel value emitted as the `value` field of autocomplete error
 * placeholder choices. Exported so command handlers can guard against users
 * who submit the sentinel literally (e.g., by typing `__autocomplete_error__`
 * directly or selecting the placeholder choice from the autocomplete UI).
 * Backlog entry for that submission-time guard lives in BACKLOG.md.
 */
export const AUTOCOMPLETE_ERROR_SENTINEL = '__autocomplete_error__';
