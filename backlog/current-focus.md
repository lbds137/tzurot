## 🎯 Current Focus

_This week's active work. Max 3 items._

### Active

1. **PR-2n epic — Phase 2 (services extraction)** — see [`active-epic.md`](backlog/active-epic.md). Sequencing: `PR-2o ✅ → Phase 2.5 (a ✅ → b ✅ → c → d) → PR-2p → PR-2q`. **2.5a shipped (#1153)**: ContextDataSource + shadow hydration (`CONTEXT_SHADOW_HYDRATION`). **2.5b shipped 2026-06-04 (#1154)**: 3 internal gateway endpoints (assistant-message persist, combined sync, personality routing read) + dual-write (`CONTEXT_DUAL_WRITE`). **Next: 2.5c** — cutover behind `CONTEXT_MODE` (thin envelopes, ContextStep hydrates, bot-client Prisma writes stop); prerequisite: negative caching in front of the routing read; fold-forward nits listed in active-epic.md.

   _v3.0.0-beta.127 shipped 2026-06-03 (#1146) — prod-validated. See [CURRENT.md](../CURRENT.md)._

### Quick-wins available between phases

1 item in [`quick-wins.md`](quick-wins.md) (stacked-JSDoc merge in `check-duplicate-exports.ts`) — the 2026-06-03 sweep shipped the rest (#1147–#1151).

### Candidate next-themes (after PR-2n)

1. **Self-Hosted TTS + BYOK Re-Eval — BYOK bake-off** ([future-themes.md](future-themes.md)): pricing-and-quality probe of Cartesia / Fish Audio / PlayHT / Resemble vs current Mistral. CPU self-hosted side closed 2026-05-13 (Pocket TTS wins the 1–4 min use case).
2. **Voice references trim** ([inbox.md](inbox.md)): 8 personalities silently failing Mistral cloning (refs >30s). Owner-action, no code.
