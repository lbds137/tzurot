## 🏗 Active Epic: Memory System Overhaul

_Focus: implement the ACCEPTED memory architecture — typed memories (episode/fact/reflection/canon) with social scoping pools, async extraction, relationship blocks, consolidation, and hybrid retrieval, evolved in-house on pgvector. Promoted 2026-07-06 after the Spinoff-Theme Knockout completed (its two trigger-gated stragglers — PGLite phases 2–3, z.ai samples — returned to the cold queue)._

**Governing artifact**: [`docs/proposals/backlog/memory-architecture.md`](../docs/proposals/backlog/memory-architecture.md) (ACCEPTED 2026-07-05; owner-signed; full-trio council). The eval harness (§3.9) is the load-bearing gate: every phase ships with its before/after corpus run, and phases 3–6 proceed only if the numbers show the prior phase paid off.

### Roadmap (artifact §5 — each phase independently shippable, quality-gated)

| Phase | Contents | Status |
| --- | --- | --- |
| 0 — integrity + eval baseline | visibility filter, re-embed, linkage, delete propagation, scoping columns, golden corpus | ✅ DONE 2026-07-05 (#1490/#1497/#1498) |
| **2 slice 1** — memory_facts schema + types | table + supersession chain + 3-registry-protected ivfflat + JobType/schemas/generator | ✅ DONE 2026-07-07 (#1527; 3 review rounds, all findings applied; dev migrated) |
| **2 slice 2** — extraction worker (shadow) + goldens + tripwire | trigger/budget/service/store/prompt + eval harness + revival semantics | ✅ DONE 2026-07-07 (#1528; 7 review rounds — every round's findings real: crash vector, provenance leak, BullMQ config, PII logs, revival bug; dev shadow-enabled EXTRACTION_ENABLED=true) |
| 1a — hybrid retrieval | dense + FTS-OR + recency RRF | **A/B RUN 2026-07-12 on the real 800-row Lila corpus (20 pooled queries, LLM-judge, `poolScoring`): RRF ≈ dense (recall@10 0.583 vs 0.571; recall@5 0.479 vs 0.496 — RRF slightly WORSE). SECOND near-null after the toy corpus. RRF-as-implemented does NOT clear the bar → owner call: don't un-park standalone.** FTS did genuinely save 2 queries dense missed (rare-term, screenshot) — the lexical arm has value; the fusion dilutes dense's wins. Keep the branch's FTS-index work as INPUT to 1c rather than merging RRF. Branch `feat/memory-hybrid-retrieval` stays parked pending that decision. |
| **2 — typed memories + extraction worker** | Extraction WRITE side shipped shadow in slices 1–2. Remaining = a **3-slice arc** (build-time council 2026-07-09, GLM 5.2 · Kimi K2.7 · Qwen 3.7): **4a** fact READ path behind `FACTS_IN_PROMPT_ENABLED` (dev-on/prod-off) — `FactRetriever` + reserved fact sub-budget + `<facts>` block + recency/salience tiebreak · **quality slice** eval→source-grounded + grow goldens + tune (confirmed the 39% "hallucination" WAS mostly golden under-enumeration; tuned to **10.3% violation / 99.6% recall**) · **correction slice** `/memory correct\|forget` + extraction respects `isLocked`/`forgotten`. Prod-enable after gate + correction + burn-in. Episode `type`/`salience` deferred to Phase 1b. | **IN PROGRESS — 4a ✅#1565, quality ✅#1566, correction ✅#1567+#1568 (slice COMPLETE). Remaining: extraction-cost quick win (Quick Wins board) → gate-bar owner call → prod-enable** |
| 1b — full composite scoring | type-weights, salience, superseded/contradiction penalties (needs Phase 2's types) | after 2 |
| 1c — retrieval-QUERY sophistication | Production embeds the RAW user message verbatim (`MemoryRetriever.ts` → `queryMemories(userMessage,…)`) — naive for chat: short reactive messages carry no retrievable meaning, pronouns don't resolve, the topic lives turns back. **PROMOTED from candidate to the PRIMARY next retrieval bet by the 2026-07-12 A/B: 6/20 (30%) queries had BOTH arms find nothing relevant — all vague/referential/compound, where the memory's wording diverges from the message's. That is a RECALL-at-the-query-layer failure no ranking change (1a) can fix.** Ladder: fold recent turns into the embedded text → LLM query condensation/rewrite → multi-query. Measured on the same goldens (`pnpm eval:pool-goldens` → `poolScoring`); the local `AB-RESULT.md` is the before-baseline. | NEXT retrieval bet (evidence-backed) |
| 3 — scoping matrix activation | pool blend + community consent + encapsulation toggle + fiction flag. **Owner design input (2026-07-10)**: (a) classify facts at extraction time as OBJECTIVE (persona-global — "has a cat named Miso", true with every character) vs RELATIONAL (relationship-experience — "confided X to this character") so the blend policy can widen them differently; the §2.2 matrix covers where a fact is visible but not this distinction. (b) ~~sharing asymmetry~~ DECIDED+SHIPPED 2026-07-10 (owner: "asymmetry usually bugs me"): facts now honor `shareLtmAcrossPersonalities` exactly like episodes; the cross-personality browse VIEW is a follow-ups row. | evidence-gated |
| 4 — relationship layer | relationship blocks via boulder-#2 V-tier | evidence-gated |
| 5 — consolidation | scheduled jobs, tier aging (light stages first) | evidence-gated |
| 6 — curation surfaces | lore books, pins-generalization, `/memory share` | evidence-gated |

**Minimum-viable milestone**: Phases 0 + 1a + 2 — the smallest system that should visibly improve roleplay quality. **Backfill posture**: no bulk re-extraction of the existing corpus; old episodes get retrieval gains as-is.

### Phase-1a park (full context in the phase entry below)

The A/B on the toy corpus measured ZERO recall lift (both 0.889) — parked per the artifact's own evidence gate. Findings shaping the resume: BGE-small subword tokenization already handles short-query rare-token recall; the one both-modes failure needs BM25-class IDF (vanilla Postgres lacks it — Phase 1b note). Resume gate: real-scale goldens from prod data (owner-involved query construction). Privacy call RESOLVED 2026-07-12 (owner, on real-sample evidence): the corpus is **LOCAL-ONLY, never committed** — content is sensitive beyond entity swaps (identifying narratives, third-party accounts); committed artifacts = the deterministic miner (#1608) + query goldens. Corpus mined (800/19,169 rows, Lila persona, dev). Ride-alongs for the resume touch: goldens `$comment` rewording, `PgvectorTypes` threshold JSDoc reorder.

### Design inputs

[`docs/proposals/backlog/MEMORY_INGESTION_IMPROVEMENTS.md`](../docs/proposals/backlog/MEMORY_INGESTION_IMPROVEMENTS.md) remains the ingestion-side input (artifact §3.1 note) — feeds Phase 2 extraction design.

### Design inputs from the external Fable review (2026-07-06)

- **STM/LTM dedup hole (review item 8) — the epic must fix this architecturally, not piecemeal**: LTM retrieval excludes memories newer than `oldestFetchedTimestamp − buffer` assuming history covers them, but history selection drops the OLDEST fetched messages under budget pressure — the dropped range is reachable by NEITHER path. Ordering circularity (retrieval runs before allocation) means the true truncation point isn't known at cutoff time; candidate resolutions: pessimistic predicted-truncation cutoff, post-allocation second LTM query over the dropped range, or restructuring the retrieval/allocation sequence. **The invariant the epic must enforce and test: every fetched message is reachable via exactly one of shipped-history or LTM.**
- **Systemic lens for the epic**: items 7+8 are one bug family — budget-adjacent code trusting PRE-truncation state for decisions whose correctness depends on POST-truncation state. Token-counting is also inconsistent (chars/4 vs tiktoken-on-XML) — unify in the epic. Anywhere consuming `rawConversationHistory` size, `oldestHistoryTimestamp`, or per-entry `tokenCount` for allocation/exclusion is suspect until checked.

### Still-live items not owned by the artifact

- **Cross-channel history — smarter retrieval with limits**: limit messages per channel, prioritize channels with active conversations (automatic retrieval path at generation time; distinct from user-driven `/history range` import).

_Per-PR slice detail goes to [`cold/epic-log.md`](cold/epic-log.md) as phases build. Completed-knockout writeup lives in git history (2026-07-06)._
