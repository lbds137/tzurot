## 🎯 Current Focus

_This week's active work. Max 3 items._

### Active

1. **`/inspect` production fix + server-side filtering** ([production-issues.md](production-issues.md)) — IN PROGRESS. PATCH `/response-ids` → `requireServiceAuth`; GET diagnostic routes → `requireUserAuth` + server-side userId filtering in Prisma WHERE clauses (replaces client-side `filterUserId` anti-pattern flagged by council). 5 routes, ~10 files including tests. Council pass complete (2026-05-23, gemini-3.1-pro-preview).
2. **adminFetch + admin-routes architectural refactor** — QUEUED, follows item 1 immediately. Council-recommended fix for the recurring "bot-client forgot to send X-User-Id" footgun:
   - Split client-side `adminFetch(path, { userId? })` → `serviceFetch(path)` (service-only, no user header) + `userFetch(path, userId, options)` (userId REQUIRED positional, both headers). TS-enforced intent at every call site.
   - Reorganize server-side route prefixes: `/api/internal/*` (requireServiceAuth mounted globally), `/api/admin/*` (requireOwnerAuth), `/api/user/*` (requireUserAuth). Route prefix carries the auth contract; no per-route ad-hoc middleware.
   - This is a system-wide migration touching every existing admin route + every bot-client call site. Needs its own council pass on the migration plan. Filing as Active Epic candidate once item 1 ships — likely 2-3 phased PRs (introduce new helpers + prefix mounts → migrate routes → delete legacy adminFetch + old prefix mounts).

### Most likely next-session pickups

1. **Self-Hosted TTS + BYOK Re-Eval — BYOK bake-off** ([future-themes.md](future-themes.md)): pricing-and-quality probe of Cartesia / Fish Audio / PlayHT / Resemble against current Mistral. The CPU self-hosted side closed 2026-05-13 — Pocket TTS uniquely wins and covers the 1-4 min use case. Step 0: research-pass compile of current BYOK pricing landscape; then hands-on API probes against existing emily/lila/lilith references using the reusable May-13 pattern.
2. **Voice references trim** ([inbox.md](inbox.md)): 8 personalities silently failing Mistral cloning (refs >30s). Owner-action only — no code work, but worth doing post-deploy to verify the audit tool's prod-side correctness.

### Other in-flight

_None._
