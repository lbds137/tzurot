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
 * Background: a user-reported bug (2026-04-21) intermittently flagged
 * users with active paid keys as "Guest Mode" because the wallet
 * check treated any `/wallet/list` gateway failure as "no keys." The
 * same pattern had already been flagged on PR #819 for NSFW
 * verification. Widening the return type for these checks is the
 * structural fix; see `BACKLOG.md` for the full class-of-bug note.
 */
export type ApiCheck<T> = { kind: 'ok'; value: T } | { kind: 'error'; error: string };
