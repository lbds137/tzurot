## 🎯 Current Focus

_This week's active work. Max 3 items._

### Active

1. **PR-2n epic — Phase 2 (services extraction)** — see [`active-epic.md`](backlog/active-epic.md). Sequencing: `PR-2o ✅ → Phase 2.5 (a ✅ → b → c → d) → PR-2p → PR-2q`. Phase 2.5 design SETTLED (council 2026-06-04, Fork 2 unanimous + routing-reads caveat; slicing in active-epic.md). **2.5a shipped 2026-06-04 (#1153)** — ContextDataSource + shadow hydration behind `CONTEXT_SHADOW_HYDRATION`. **Next: 2.5b** — api-gateway internal write endpoints (delivery confirmation, edit sync, delete sync) + cached routing-read endpoint(s); bot-client dual-writes for verification.

   _v3.0.0-beta.127 shipped 2026-06-03 (#1146) — prod-validated. See [CURRENT.md](../CURRENT.md)._

### Quick-wins available between phases

1 item in [`quick-wins.md`](quick-wins.md) (stacked-JSDoc merge in `check-duplicate-exports.ts`) — the 2026-06-03 sweep shipped the rest (#1147–#1151).

### Candidate next-themes (after PR-2n)

1. **Self-Hosted TTS + BYOK Re-Eval — BYOK bake-off** ([future-themes.md](future-themes.md)): pricing-and-quality probe of Cartesia / Fish Audio / PlayHT / Resemble vs current Mistral. CPU self-hosted side closed 2026-05-13 (Pocket TTS wins the 1–4 min use case).
2. **Voice references trim** ([inbox.md](inbox.md)): 8 personalities silently failing Mistral cloning (refs >30s). Owner-action, no code.
