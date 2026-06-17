## 🎯 Current Focus

_This week's active work. Max 3 items._

### Active

1. **PR-2n epic — Phase 2 (services extraction)** — see [`active-epic.md`](backlog/active-epic.md). Sequencing: `PR-2o ✅ → Phase 2.5 (a ✅ → b ✅ → c-i ✅ → c-ii ✅ → c-iii → d) → PR-2p → PR-2q`. Shipped 2026-06-04: **2.5a** (#1153, shadow hydration), **2.5b** (#1154, 3 gateway endpoints + dual-write), **2.5c-i** (#1155, write cutover behind `CONTEXT_MODE`), **2.5c-ii** (#1156, routing-read cutover: `HttpPersonalityLoader` + positive/negative cache). **2.5c-iii: iii-0 ✅ (#1157) → iii-a1 ✅ (#1159) → iii-a2 ✅ (#1160) → iii-a3 ✅ (#1161/#1162/#1163/#1165) → Fork C ✅ (#1166) → voice ground truth ✅ (#1169) → shadow burn-in ✅ GREEN (2026-06-08) → iii-b-1 ✅ (#1182) → iii-b-2 ✅ (#1183, thin payload) → iii-b-3 ✅ (#1194/#1195, last thin-payload holdouts dropped) → iii-cleanup ✅ (#1196, 6 carried fold-forwards). All shipped to prod in beta.130 (2026-06-14). NEXT: 2.5d** — delete legacy paths + `MessageContextBuilder` + bot-client's Prisma injections + the `CONTEXT_*` flags, tighten the depcruise guard. Unblocks PR-2p. Fold-forward details for 2.5d are in active-epic.md (§ 2.5d entry).

   _Epic work is prod-validated through beta.130 (#1200). Latest release: **beta.133** (2026-06-17) — the context-assembly fix family + `/character import` timeout fix. The pre-beta.133 forwarded + slash-command batch (forwarded-link crawl #1227, write-timeouts #1228, origin-channel enrichment #1229, `/character chat` split #1230, list→browse #1231, `/help` + terminology audit #1232/#1233) all shipped. See [CURRENT.md](../CURRENT.md) for the full post-release state and candidate next threads._

### Quick-wins available between phases

Three open in [`quick-wins.md`](quick-wins.md), all beta.133 review follow-ups — good momentum work between 2.5d slices: converge the two gateway `LlmConfigResolver` instances (+ optional pub/sub), align the write-side `findFirst` with the `id` tiebreak, and the dedup-stub edge-case tests.

### Candidate next-themes (after PR-2n)

1. **Self-Hosted TTS + BYOK Re-Eval — BYOK bake-off** ([future-themes.md](future-themes.md)): pricing-and-quality probe of Cartesia / Fish Audio / PlayHT / Resemble vs current Mistral. CPU self-hosted side closed 2026-05-13 (Pocket TTS wins the 1–4 min use case).
2. **Voice references trim** ([inbox.md](inbox.md)): 8 personalities silently failing Mistral cloning (refs >30s). Owner-action, no code.
