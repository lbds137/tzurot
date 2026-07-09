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
| **2 slice 4a** | **fact READ path** — `FactRetriever` (reuses `findSimilarActiveFacts` + recency/salience tiebreak), reserved fact sub-budget, `<facts>` block, `FACTS_IN_PROMPT_ENABLED` dev-flag, `personaId` from `MemoryRetriever` for scope+skip inheritance, `<facts>`/`<fact>` in PROTECTED_TAGS. No worker changes (revival is exact-hash, not fuzzy — council misread corrected). Fact recall eval deferred to the quality slice. | ✅ PR #1565 (in review) |
| 2 quality slice | eval→source-grounded correctness, grow goldens ~50, re-baseline, tune to the go-live gate | NEXT |
| 2 correction slice | `/memory correct\|forget` + extraction respects `isLocked`/`forgotten` | after quality |

## Spinoff-Theme Knockout (beta.146+) — prior epic

_Shipped items tracked in git history + `active-epic.md` (warmup ✅, 4 themes closed ✅, process-refit PR #1468 ✅)._
