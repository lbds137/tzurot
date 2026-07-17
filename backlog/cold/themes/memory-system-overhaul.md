### Theme: Memory System Overhaul — PARKED MID-EPIC (2026-07-17)

_Focus: implement the ACCEPTED memory architecture — typed memories (episode/fact/reflection/canon) with social scoping pools, async extraction, relationship blocks, consolidation, and hybrid retrieval, evolved in-house on pgvector._

**Parked 2026-07-17** (owner re-sequence: Platform-Portable UX Layer promoted to active epic). The park lands at a natural pause: everything buildable was built and shipped; what remains is either awaiting an owner re-measure or evidence-gated. Was active epic 2026-07-06 → 2026-07-17.

**Governing artifact**: [`docs/proposals/backlog/memory-architecture.md`](../../../docs/proposals/backlog/memory-architecture.md) (ACCEPTED 2026-07-05; owner-signed; full-trio council). The eval harness (§3.9) is the load-bearing gate — it refuted three plausible builds in a row (RRF, fold, composite scoring), exactly as designed.

### Re-entry triggers (what un-parks this)

1. **Owner's felt-repetition re-measure** (post slice-A + dedup-hole fix in prod) — gates 1b slice B (read-side dup collapse, current recommendation DON'T-BUILD) and correction detection.
2. **Evidence gates opening on phases 3–6** (scoping matrix, relationship layer, consolidation, curation).
3. The `cold/follow-ups.md` promote-when rows: correction detection, write-side dedup, prompt temporal awareness, revival evidence-gate.

### Roadmap state at park (artifact §5)

| Phase | Status |
| --- | --- |
| 0 — integrity + eval baseline | ✅ DONE 2026-07-05 (#1490/#1497/#1498) |
| 2 — typed memories + extraction (all slices: schema #1527, shadow worker #1528, READ path #1565, quality #1566, correction #1567/#1568, cost knobs) | ✅ DONE 2026-07-13; **PROD-ENABLED** (`extractionEnabled` + `factsInPromptEnabled` both ON in prod, owner-confirmed). Episode `type`/`salience` deferred to 1b. |
| 1a — hybrid retrieval (RRF) | **REFUTED twice** (toy + real 800-row corpus: RRF ≈ dense, slightly worse @5). Branch `feat/memory-hybrid-retrieval` STAYS PARKED (owner 2026-07-12) as FTS-index input — FTS genuinely saved 2 rare-term queries; the fusion diluted dense's wins. |
| 1b — composite scoring | **Sim REFUTED 2026-07-13/14** (40 judged goldens, owner-confirmed verdict FINAL): prod ordering wins outright (recall@10 0.695); every pre-registered composite loses; salience-as-extracted is anti-signal. **Redirect shipped**: slice A (valid_from = evidence time) ✅ #1644 released beta.165, dev+prod repaired (21,493 rows, class closed). **Slice B (read-side dup collapse): recommendation DON'T-BUILD** — offline gate showed quality-neutral at 0.95 with ~1 wasted slot/400 benefit; at 0.90 real false-collapses. Awaiting the owner's felt-repetition re-measure. Real 1b targets identified by the judging (near-dup rows flooding pools, event-obsoleted facts co-ranking, wrong-entity class at retrieval) — the design inputs below. Full verdict: `reports/goldens-mining/fact-sim-verdict.md` (local). |
| 1c — retrieval-query sophistication | ✅ DONE 2026-07-12 — honest re-baseline (4 slices #1610–#1613) refuted the fold as a global win (bare 0.436 vs fold3 0.390); **conditional-fold shipped #1614** (fold iff <5 content words; cond 0.548, 4 fixes / 0 breaks); rung-2 (LLM rewrite) refuted. |
| 3 — scoping matrix activation | evidence-gated. Owner design input 2026-07-10: classify facts OBJECTIVE (persona-global) vs RELATIONAL (relationship-experience) at extraction so the blend policy can widen them differently. Sharing asymmetry already DECIDED+SHIPPED 2026-07-10 (facts honor `shareLtmAcrossPersonalities`; cross-personality browse view is a follow-ups row). |
| 4 — relationship layer (boulder-#2 V-tier) | evidence-gated |
| 5 — consolidation (scheduled jobs, tier aging) | evidence-gated |
| 6 — curation surfaces (lore books, pins, `/memory share`) | evidence-gated |

**Backfill posture**: no bulk re-extraction of the existing corpus; old episodes get retrieval gains as-is.

### Design inputs for the 1b design session (when un-parked)

- **Prod user feedback on facts quality (2026-07-13, "I like waffles" DM)** — three organic-prod signals, matching the judging's targets 1:1: (a) **wrong-entity fact** ("Sapphomet is also known as 'Lila'" — alias attributed to the wrong subject; the 10.3%-violation extraction-hallucination class in the wild). (b) **Same fact surfaces repeatedly** across turns — mechanism confirmed by the judging to be duplicate ROWS (six "is a trans woman" variants co-ranking), not ranking; backfill-era near-duplicates plausibly contribute (dev facts DO reach prod via the owner's db-sync runs — memory_facts is in the sync set). (c) **Corrections don't stick** (repeated misgendering corrections): corrected/fresh facts must outrank stale ones at retrieval; verified 2026-07-13 the forget/correct guard is IDENTITY-based (sha256 UUID + revival guard) — a PARAPHRASE of a forgotten assertion mints a fresh row the tombstone can't see; semantic-level dedup/blocking is 1b's to design. Immediate user remedy relayed (`/memory correct` over bare forget). Fold (a)–(c) + the semantic-guard gap into the 1b design session as acceptance criteria.
- **Event-staleness handling**: "surgery scheduled Mar 2026" co-ranking with "has undergone surgery" in post-op threads — supersession chains can't see event-obsoleted facts.
- **Extraction-time correction detection** (in-conversation corrections never reach the corrected tier — only explicit `/memory correct` does; only 2 corrected rows in all of dev, base-rate emptiness confirmed not a reachability bug).
- [`docs/proposals/backlog/MEMORY_INGESTION_IMPROVEMENTS.md`](../../../docs/proposals/backlog/MEMORY_INGESTION_IMPROVEMENTS.md) — ingestion-side input (artifact §3.1 note).
- **Systemic lens (external Fable review 2026-07-06, items 7+8)**: budget-adjacent code trusting PRE-truncation state for POST-truncation-dependent decisions is one bug family (the STM/LTM dedup hole was ✅ fixed #1645, released beta.165); token-counting is inconsistent (chars/4 vs tiktoken-on-XML) — unify in the epic. Anything consuming `rawConversationHistory` size, `oldestHistoryTimestamp`, or per-entry `tokenCount` for allocation/exclusion is suspect until checked.

### Phase-1a park detail

Privacy call RESOLVED 2026-07-12 (owner, on real-sample evidence): the mined corpus is **LOCAL-ONLY, never committed** (identifying narratives, third-party accounts); committed artifacts = the deterministic miner (#1608) + query goldens. Corpus mined (800/19,169 rows, Lila persona, dev). Ride-alongs for the resume touch: goldens `$comment` rewording, `PgvectorTypes` threshold JSDoc reorder.

### Still-live items not owned by the artifact

- **Cross-channel history — smarter retrieval with limits**: limit messages per channel, prioritize channels with active conversations (automatic retrieval path at generation time; distinct from user-driven `/history range` import).

_The epic's per-PR slice log lives in git history of `cold/epic-log.md` (reset at the 2026-07-17 park)._
