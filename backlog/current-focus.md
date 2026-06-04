## 🎯 Current Focus

_This week's active work. Max 3 items._

### Active

1. **PR-2n epic — Phase 2 (services extraction)** — see [`active-epic.md`](backlog/active-epic.md). Design SETTLED (council, Hybrid). Sequencing: `PR-2o ✅ → Phase 2.5 → PR-2p → PR-2q`. **PR-2o shipped 2026-06-04 (#1152)** — retention → api-gateway, vision cache → ai-worker; the resolver stack was falsified as 2-consumer and re-routed to 2p (evidence in active-epic.md). **Next: Phase 2.5 scoping pass** (make bot-client Prisma-free — enumerate bot-client's DB reads, design gateway endpoints, then tighten the depcruise guard). The epic prescribes scoping before code; likely its own mini-epic.

   _v3.0.0-beta.127 shipped 2026-06-03 (#1146) — prod-validated. See [CURRENT.md](../CURRENT.md)._

### Quick-wins available between phases

6 items in [`quick-wins.md`](quick-wins.md) — notably **`guard:dockerfile-dist`** (the exact gap that just crashed bot-client in dev) and **remove dead `redis`** dependency.

### Candidate next-themes (after PR-2n)

1. **Self-Hosted TTS + BYOK Re-Eval — BYOK bake-off** ([future-themes.md](future-themes.md)): pricing-and-quality probe of Cartesia / Fish Audio / PlayHT / Resemble vs current Mistral. CPU self-hosted side closed 2026-05-13 (Pocket TTS wins the 1–4 min use case).
2. **Voice references trim** ([inbox.md](inbox.md)): 8 personalities silently failing Mistral cloning (refs >30s). Owner-action, no code.
