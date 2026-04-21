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
