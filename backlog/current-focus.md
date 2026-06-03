## 🎯 Current Focus

_This week's active work. Max 3 items._

### Active

1. **Cut v3.0.0-beta.127 release** — develop has ~40 commits since beta.126 (tagged 2026-05-30), including two structural arcs reaching prod for the first time: **PR-2m** (`@tzurot/clients` extraction + the now fully-cut-over typed-client boundary — 0 legacy gateway callsites remain) and **PR-2n Phase 1** (factories → `@tzurot/test-factories`), plus api-gateway route/contract refactors, dep bumps (#1137 dev / #1144 prod), and the **bot-client Dockerfile crash fix (#1145)**. The Dockerfile fix is load-bearing: beta.127 is the first prod carry of `@tzurot/clients`, and without it the prod bot-client deploy crashes (`ERR_MODULE_NOT_FOUND`) — already dev-validated (deploy SUCCESS, clean boot). **No migrations in the delta.** Pre-cut gate: a dev smoke of the typed-client surfaces (scope being scoped with user — likely narrower than beta.126's full surface). Then: release PR develop→main → wait green CI + read the holistic claude-review → merge → watch all 3 prod deploys (bot-client clean rebuild especially) → re-smoke prod core flows → tag → GitHub release → `release:finalize` → reset CURRENT.md.

2. **PR-2n epic — Phase 2 (services extraction)** — see [`active-epic.md`](active-epic.md). After the release. Open decision before code: Phase 2.5 (bot-client→Prisma proper fix) before PR-2p (singleton eviction)? First code PR is **PR-2o** (relocate single-consumer services to ai-worker/api-gateway — lowest-risk opener).

### Quick-wins available between phases

6 items in [`quick-wins.md`](quick-wins.md) — notably **`guard:dockerfile-dist`** (the exact gap that just crashed bot-client in dev) and **remove dead `redis`** dependency.

### Candidate next-themes (after PR-2n)

1. **Self-Hosted TTS + BYOK Re-Eval — BYOK bake-off** ([future-themes.md](future-themes.md)): pricing-and-quality probe of Cartesia / Fish Audio / PlayHT / Resemble vs current Mistral. CPU self-hosted side closed 2026-05-13 (Pocket TTS wins the 1–4 min use case).
2. **Voice references trim** ([inbox.md](inbox.md)): 8 personalities silently failing Mistral cloning (refs >30s). Owner-action, no code.
