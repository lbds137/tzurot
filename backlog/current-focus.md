## 🎯 Current Focus

_This week's active work. Max 3 items._

### Active

1. **PR-2n epic — Phase 2 (services extraction)** — see [`active-epic.md`](backlog/active-epic.md). Design SETTLED (council, Hybrid). **Sequencing DECIDED: `PR-2o → Phase 2.5 → PR-2p → PR-2q`** (optimized for no stopgaps — 2.5 lands before the 2p singleton eviction so bot-client never needs a temporary local Prisma). **Next code PR: PR-2o** (relocate single-consumer services — ai-worker resolver stack + `ConversationRetentionService` → api-gateway; lowest-risk opener, no Prisma/bot-client entanglement). Phase 2.5 (make bot-client Prisma-free) is the heavy one and gets a scoping pass when reached.

   _v3.0.0-beta.127 shipped 2026-06-03 (#1146) — prod-validated, all 3 services clean. See [CURRENT.md](../CURRENT.md)._

### Quick-wins available between phases

6 items in [`quick-wins.md`](quick-wins.md) — notably **`guard:dockerfile-dist`** (the exact gap that just crashed bot-client in dev) and **remove dead `redis`** dependency.

### Candidate next-themes (after PR-2n)

1. **Self-Hosted TTS + BYOK Re-Eval — BYOK bake-off** ([future-themes.md](future-themes.md)): pricing-and-quality probe of Cartesia / Fish Audio / PlayHT / Resemble vs current Mistral. CPU self-hosted side closed 2026-05-13 (Pocket TTS wins the 1–4 min use case).
2. **Voice references trim** ([inbox.md](inbox.md)): 8 personalities silently failing Mistral cloning (refs >30s). Owner-action, no code.
