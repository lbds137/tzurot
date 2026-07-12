# Active Epic — Detailed Log

_Per-PR slice detail for the current Active Focus (see [`../active-epic.md`](../active-epic.md)). Reset when the active epic/sweep changes — completed epics' logs live in git history._

## Memory System Overhaul (Active Epic)

_Governing artifact: `docs/proposals/backlog/memory-architecture.md`. Roadmap in `active-epic.md`._

| Slice | What | Status |
| --- | --- | --- |
| Phase 0 | integrity + eval baseline (visibility filter, re-embed, scoping cols, golden corpus) | ✅ #1490/#1497/#1498 |
| 2 slice 1 | `memory_facts` schema + supersession chain + ivfflat + JobType/schemas | ✅ #1527 |
| 2 slice 2 | extraction worker (shadow) + goldens + tripwire + revival | ✅ #1528 (`EXTRACTION_ENABLED=true` on dev) |
| 1a | hybrid retrieval (dense+FTS+RRF) | BUILT + PARKED (`feat/memory-hybrid-retrieval`; zero-lift on toy corpus; resume = real-scale goldens) |
| **2 slice 4a** | **fact READ path** — `FactRetriever` (reuses `findSimilarActiveFacts` + recency/salience tiebreak), reserved fact sub-budget, `<facts>` block, `FACTS_IN_PROMPT_ENABLED` dev-flag, `personaId` from `MemoryRetriever` for scope+skip inheritance, `<facts>`/`<fact>` in PROTECTED_TAGS. No worker changes (revival is exact-hash, not fuzzy — council misread corrected). Fact recall eval deferred to the quality slice. | ✅ MERGED #1565 (3 review rounds, none blocking) |
| 2 quality slice | eval→source-grounded (`scoreExtraction`: recall vs `expectFacts`, violation = matches neither list), goldens 16→50, prompt tuned (durability + atomicity). **Result: 10.3% violation / 99.6% recall / 100% supersession** (from v1's 39% "hallucination" that was mostly golden under-enumeration). Ride-alongs: `FactStore.component.test.ts` (real-PGLite `findSimilarActiveFacts` incl. tiebreak — CI-gated, closes the review's SQL-never-in-CI gap); `selectFacts` boundary test. **Gate-bar (5% strict vs 10% pragmatic) → OWNER call, informed by the number.** | ✅ PR #1566 (in review) |
| ↳ deferred from quality slice | Fact **recall@K measurement** (retrieval golden corpus + baseline number, distinct from the CI correctness test) — gated on real-scale fact-retrieval goldens (same evidence gate as the parked episode-retrieval eval; toy corpus repeats phase-1a zero-lift). Promote when: approaching prod-enable, owner-driven query construction. | deferred |
| 2 correction slice — backend | gateway fact routes (list/get/correct/forget/lock), lock = hard-freeze consistent w/ episode locks (owner call), corrected-TIER shields from extraction (both layers, PGLite-tested), collision semantics (locked-merge/unlocked-claim/dead-revive/forgotten-override), forget race-hardened | ✅ MERGED #1567 (4 rounds; round-1 collision clobber + round-2 forget race + merge-hole all reviewer-caught and fixed) |
| 2 correction slice — UI | bot-client `/memory facts` browse+detail (Correct/Forget/Lock; locked facts render Correct/Forget disabled — hard-freeze visible). 2 clean reviews + a codecov round (+392 test lines); 1 unrelated DuplicateDetectionFlow P2002 flake (rerun-cleared; file if it recurs) | ✅ MERGED #1568 |
| extraction-cost knobs | `EXTRACTION_MODEL`/`EXTRACTION_DAILY_LIMIT` env, usage_logs rows (requestType fact_extraction), X-Title "Extraction" split | ✅ MERGED #1569 |
| prod-enable | flip `FACTS_IN_PROMPT_ENABLED` after gate + correction + burn-in. **Check first**: sequential fact-retrieval latency (second embedding+DB round-trip after episode retrieval — #1565 review item 3; the filed diagnostic follow-up labels it) | gated |
| 1c re-baseline (honest) | **Correction**: context-folding ALREADY SHIPS (`extractRecentHistoryWindow`+`buildSearchQuery`, last 3 turns → both arms); the A/B's 30%-both-miss measured the BARE message, which prod doesn't do. Re-baseline via real Lila turns mined from dev `ConversationHistory` (owner: synced from prod, 30-day window) → reconstruct exact folded query offline → paired bare-vs-folded A/B + turn sweep + non-circularity guard (STM/LTM cutoff + lexical echo). Plan `.claude/plans/mutable-doodling-thunder.md`. **Synthetic query-drafts (#1608) RETIRED for the fold measurement** — LLM-drafted + context-free, can't exercise the fold; kept only for the bug-fixed bare-message honesty re-score. 4 slices: PR-1 turn-count param (prod) · PR-2 conversation-goldens miner (local) · PR-3 fold-aware runner + #1609 dedup fix (local) · PR-4 scoring extensions: both-miss/paired-flips/guard-mask (mixed). Residual both-miss AFTER folding decides rung-2 (LLM rewrite). Build-time council on guard thresholds + min-n. | IN PROGRESS — #1609 pooling instrument merged; 4 slices next |

## Spinoff-Theme Knockout (beta.146+) — prior epic

_Shipped items tracked in git history + `active-epic.md` (warmup ✅, 4 themes closed ✅, process-refit PR #1468 ✅)._
