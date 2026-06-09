## 🎯 Current Focus

_This week's active work. Max 3 items._

### Active

1. **PR-2n epic — Phase 2 (services extraction)** — see [`active-epic.md`](backlog/active-epic.md). Sequencing: `PR-2o ✅ → Phase 2.5 (a ✅ → b ✅ → c-i ✅ → c-ii ✅ → c-iii → d) → PR-2p → PR-2q`. Shipped 2026-06-04: **2.5a** (#1153, shadow hydration), **2.5b** (#1154, 3 gateway endpoints + dual-write), **2.5c-i** (#1155, write cutover behind `CONTEXT_MODE`), **2.5c-ii** (#1156, routing-read cutover: `HttpPersonalityLoader` + positive/negative cache). **2.5c-iii: iii-0 ✅ (#1157) → iii-a1 ✅ (#1159) → iii-a2 ✅ (#1160) → iii-a3 ✅ (#1161/#1162/#1163/#1165) → Fork C ✅ (#1166) → voice ground truth ✅ (#1169) → shadow burn-in ✅ GREEN (2026-06-08) → iii-b-1 ✅ (#1182, worker promotion) → iii-b-2. Next: dev burn-in of the promoted path** (flip `CONTEXT_ASSEMBLY_PROMOTE=true`, compare flag-off vs flag-on generations), **then iii-b-2** (discriminated-union thin payload, bot stops shipping legacy fields). 3 fold-forwards from the #1182 review + the burn-in details are in active-epic.md (§ iii-b entry + § "Burn-in results"). Then 2.5d (deletion) → PR-2p.

   _v3.0.0-beta.127 shipped 2026-06-03 (#1146) — prod-validated. See [CURRENT.md](../CURRENT.md)._

2. **[FEAT] Forwarded-text link references** — _Follow-up to the forwarded-content-loss fix (`fix/forwarded-message-content-loss`)._ That fix threads the effective (snapshot) content into `MessageReferenceExtractor.extractReferencesWithReplacement` so link-replacement formats the real forwarded text. But the link **crawler** (`ReferenceCrawler` via `LinkReferenceStrategy`) still scans `message.content` to *detect* Discord message links — which is empty for forwards. So Discord links embedded inside forwarded snapshot text are not detected and never get `[Reference N]` numbering. **Action**: thread the effective content into the crawler's link-detection path (`LinkReferenceStrategy` / `ReferenceCrawler.crawl`) so forwarded links are crawled, numbered, and replaced like inline links. Start: `services/bot-client/src/handlers/references/strategies/LinkReferenceStrategy.ts`. Deliberate next-PR follow-up (not iceboxed) per user direction 2026-06-08.

### Quick-wins available between phases

1 item in [`quick-wins.md`](quick-wins.md) (stacked-JSDoc merge in `check-duplicate-exports.ts`) — the 2026-06-03 sweep shipped the rest (#1147–#1151).

### Candidate next-themes (after PR-2n)

1. **Self-Hosted TTS + BYOK Re-Eval — BYOK bake-off** ([future-themes.md](future-themes.md)): pricing-and-quality probe of Cartesia / Fish Audio / PlayHT / Resemble vs current Mistral. CPU self-hosted side closed 2026-05-13 (Pocket TTS wins the 1–4 min use case).
2. **Voice references trim** ([inbox.md](inbox.md)): 8 personalities silently failing Mistral cloning (refs >30s). Owner-action, no code.
