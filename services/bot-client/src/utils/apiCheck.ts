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
 *
 * Scope: this classification is tuned for the serve-stale-fallback question,
 * not for retry decisions. It treats all 5xx as transient (including 501
 * Not Implemented, which is technically permanent server-side) because
 * serving last-known-good data is the right fallback for any 5xx. If this
 * helper is reused for retry logic, revisit the 5xx bucket.
 */
export function isTransientHttpStatus(status: number): boolean {
  return status === 0 || status === 429 || status >= 500;
}

/**
 * Sentinel value emitted as the `value` field of autocomplete error
 * placeholder choices. Exported so command handlers can guard against users
 * who submit the sentinel literally (e.g., by typing `__autocomplete_error__`
 * directly or selecting the placeholder choice from the autocomplete UI).
 */
export const AUTOCOMPLETE_ERROR_SENTINEL = '__autocomplete_error__';

/**
 * User-facing message shown when a command handler receives the autocomplete
 * error sentinel as an option value. Submission of the sentinel means either
 * (a) the user selected the `[Unable to load — try again]` placeholder choice
 * produced by an autocomplete handler that failed its backend check, or
 * (b) the user typed the raw sentinel string and submitted without choosing
 * from the autocomplete UI. Both cases want the same wording — "retry soon,
 * the autocomplete wasn't able to load its backing data."
 */
export const AUTOCOMPLETE_UNAVAILABLE_MESSAGE =
  '⚠️ Autocomplete was unavailable — please try again in a moment.';

/**
 * Predicate for the autocomplete-error sentinel. Kept as a named predicate
 * rather than inlining `value === AUTOCOMPLETE_ERROR_SENTINEL` at call sites
 * so a future change to the sentinel shape (e.g., a prefix-based scheme) only
 * needs to touch one place.
 */
export function isAutocompleteErrorSentinel(value: string): boolean {
  return value === AUTOCOMPLETE_ERROR_SENTINEL;
}
