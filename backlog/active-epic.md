## 🏗 Active Epic: Memory System Overhaul

_Focus: implement the ACCEPTED memory architecture — typed memories (episode/fact/reflection/canon) with social scoping pools, async extraction, relationship blocks, consolidation, and hybrid retrieval, evolved in-house on pgvector. Promoted 2026-07-06 after the Spinoff-Theme Knockout completed (its two trigger-gated stragglers — PGLite phases 2–3, z.ai samples — returned to the cold queue)._

**Governing artifact**: [`docs/proposals/backlog/memory-architecture.md`](../docs/proposals/backlog/memory-architecture.md) (ACCEPTED 2026-07-05; owner-signed; full-trio council). The eval harness (§3.9) is the load-bearing gate: every phase ships with its before/after corpus run, and phases 3–6 proceed only if the numbers show the prior phase paid off.

### Roadmap (artifact §5 — each phase independently shippable, quality-gated)

| Phase | Contents | Status |
| --- | --- | --- |
| 0 — integrity + eval baseline | visibility filter, re-embed, linkage, delete propagation, scoping columns, golden corpus | ✅ DONE 2026-07-05 (#1490/#1497/#1498) |
| **2 slice 1** — memory_facts schema + types | table + supersession chain + 3-registry-protected ivfflat + JobType/schemas/generator | ✅ DONE 2026-07-07 (#1527; 3 review rounds, all findings applied; dev migrated) |
| 1a — hybrid retrieval | dense + FTS-OR + recency RRF | BUILT + PARKED on evidence (branch `feat/memory-hybrid-retrieval`; resume gate = real-scale goldens, owner session — Quick Win on the board) |
| **2 — typed memories + extraction worker** | type enum, salience, async fact extraction w/ supersession targeting, dedup guard (eval-tuned), `/memory correct\|forget` (§3.6a), cost guardrails (§3.8) live from day one | **NEXT — plan-mode + council at build time (per-phase requirement)** |
| 1b — full composite scoring | type-weights, salience, superseded/contradiction penalties (needs Phase 2's types) | after 2 |
| 3 — scoping matrix activation | pool blend + community consent + encapsulation toggle + fiction flag | evidence-gated |
| 4 — relationship layer | relationship blocks via boulder-#2 V-tier | evidence-gated |
| 5 — consolidation | scheduled jobs, tier aging (light stages first) | evidence-gated |
| 6 — curation surfaces | lore books, pins-generalization, `/memory share` | evidence-gated |

**Minimum-viable milestone**: Phases 0 + 1a + 2 — the smallest system that should visibly improve roleplay quality. **Backfill posture**: no bulk re-extraction of the existing corpus; old episodes get retrieval gains as-is.

### Phase-1a park (full context in the phase entry below)

The A/B on the toy corpus measured ZERO recall lift (both 0.889) — parked per the artifact's own evidence gate. Findings shaping the resume: BGE-small subword tokenization already handles short-query rare-token recall; the one both-modes failure needs BM25-class IDF (vanilla Postgres lacks it — Phase 1b note). Resume gate: real-scale goldens from prod data (owner-involved query construction; public-repo privacy call on fixture storage). Ride-alongs for the resume touch: goldens `$comment` rewording, `PgvectorTypes` threshold JSDoc reorder.

### Design inputs

[`docs/proposals/backlog/MEMORY_INGESTION_IMPROVEMENTS.md`](../docs/proposals/backlog/MEMORY_INGESTION_IMPROVEMENTS.md) remains the ingestion-side input (artifact §3.1 note) — feeds Phase 2 extraction design.

### Still-live items not owned by the artifact

- **Cross-channel history — smarter retrieval with limits**: limit messages per channel, prioritize channels with active conversations (automatic retrieval path at generation time; distinct from user-driven `/history range` import).

_Per-PR slice detail goes to [`cold/epic-log.md`](cold/epic-log.md) as phases build. Completed-knockout writeup lives in git history (2026-07-06)._
