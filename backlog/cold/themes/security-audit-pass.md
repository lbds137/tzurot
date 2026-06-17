### Theme: Security Audit Pass (discovery mini-epic)

_Focus: Systematic review of what a hostile user could do to harm the app. Output is a list of concrete per-finding backlog items grouped by severity, not a single PR._

**Scope**:

- (a) **api-gateway public / unauth endpoints** (image proxy, any media CDN routes, health checks, anything without `requireUserAuth` / `requireProvisionedUser`) — rate limits, resource consumption bounds, input validation.
- (b) **Endpoint authz escalation** — any route where `req.userId` / `req.provisionedUserId` could be spoofed upstream or where crafted params let a user access another user's data (persona IDs, character IDs, memory IDs, preset IDs across isolation boundaries).
- (c) **DDoS / DoS amplification** — expensive operations a single request can trigger (embedding generation, large AI context pulls, transcription jobs, TTS synthesis, multi-chunk voice), lack of per-user rate limits on paid-by-us LLM/TTS/STT calls, unbounded `findMany` queries still lurking after the 03-database.md sweep.
- (d) **Webhook / bot-client surface** — what a malicious Discord user could craft via slash-command args, message content, or voice attachments to exhaust resources (huge attachments, recursive references, adversarial reasoning-tag payloads).
- (e) **Secret leakage paths** — logs, error messages, PR bodies, commit history, git blame on removed env-handling code.

**Fix shape (meta-task output)**: one Inbox entry per finding, grouped by severity (critical / high / medium / low).

**Suggested structure**:

1. Run `/security-review` skill on the current branch as a first pass — covers the OWASP-ish code-level findings.
2. `pnpm ops xray --summary` on api-gateway + bot-client to enumerate public/unauth endpoints and walk each against categories a-d.
3. Output: concrete backlog items per finding.

**Start**: `pnpm depcruise` + `pnpm ops xray --summary` for the surface map; `services/api-gateway/src/routes/` for endpoint enumeration; `grep -r 'requireUserAuth\|requireProvisionedUser' services/api-gateway/src/routes/` to find the auth boundary. Promoted from Inbox 2026-04-22.
