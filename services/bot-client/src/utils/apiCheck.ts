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
 * Background: introduced on PR #857 after a user-reported Guest-Mode
 * lockout where a `/wallet/list` gateway failure was collapsing into
 * "no active keys." The same pattern had previously been flagged on
 * PR #819 for NSFW verification. Widening the return type for these
 * checks is the structural fix; see `BACKLOG.md` for the remaining
 * autocomplete-cache callsites that should adopt this pattern.
 */
export type ApiCheck<T> = { kind: 'ok'; value: T } | { kind: 'error'; error: string };
