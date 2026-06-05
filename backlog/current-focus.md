## 🎯 Current Focus

_This week's active work. Max 3 items._

### Active

1. **PR-2n epic — Phase 2 (services extraction)** — see [`active-epic.md`](backlog/active-epic.md). Sequencing: `PR-2o ✅ → Phase 2.5 (a ✅ → b ✅ → c-i ✅ → c-ii → c-iii → d) → PR-2p → PR-2q`. Shipped 2026-06-04: **2.5a** (#1153, shadow hydration), **2.5b** (#1154, 3 gateway endpoints + dual-write), **2.5c-i** (#1155, write cutover behind `CONTEXT_MODE`, legacy default). **Next: 2.5c-ii** — routing-read cutover: HTTP-backed `IPersonalityLoader` over `GET /internal/personality/load` + `(nameOrId, userId)` cache with positive (5 min) AND negative (30-60s) entries (required: `PersonalityService` skips its cache whenever userId is present). Then 2.5c-iii (hydration cutover, needs scoping) → 2.5d.

   _v3.0.0-beta.127 shipped 2026-06-03 (#1146) — prod-validated. See [CURRENT.md](../CURRENT.md)._

### Quick-wins available between phases

1 item in [`quick-wins.md`](quick-wins.md) (stacked-JSDoc merge in `check-duplicate-exports.ts`) — the 2026-06-03 sweep shipped the rest (#1147–#1151).

### Candidate next-themes (after PR-2n)

1. **Self-Hosted TTS + BYOK Re-Eval — BYOK bake-off** ([future-themes.md](future-themes.md)): pricing-and-quality probe of Cartesia / Fish Audio / PlayHT / Resemble vs current Mistral. CPU self-hosted side closed 2026-05-13 (Pocket TTS wins the 1–4 min use case).
2. **Voice references trim** ([inbox.md](inbox.md)): 8 personalities silently failing Mistral cloning (refs >30s). Owner-action, no code.
