### Theme: Memory System Overhaul

_Focus: implement the ACCEPTED memory architecture — typed memories (episode/fact/reflection/canon) with social scoping pools, async extraction, relationship blocks, consolidation, and hybrid retrieval, evolved in-house on pgvector._

**DESIGN ACCEPTED 2026-07-05 (boulder #3)**: [`docs/proposals/backlog/memory-architecture.md`](../../../docs/proposals/backlog/memory-architecture.md) — the adjudication (evolve in-house; Hindsight runner-up behind operationalized triggers; scope-reduction-first fallback) **supersedes this theme's prior plan**. Grounded by a 5-source sweep (OpenMemory rewrite dissection, 2026 landscape survey, current-impl map, prior-doc mining, owner's curated links + scoping model); full-trio council pass; all decisions owner-signed.

**What the artifact replaced in this theme (git preserves the old text)**:

- **Item 3 "OpenMemory Migration" is DEAD, twice over**: the waypoint-graph architecture it planned to adopt was retired by OpenMemory's own authors in their 2026 rewrite (their forensic audit judged the "brain-flavored" mechanics not production-worthy), and the adjudication rejects framework adoption generally. The 2025-11 locked decisions (text-embedding-3-large, separate Railway service, all-in cutover) are void.
- **Item 1 "LTM Summarization"** → absorbed as consolidation scene-summaries (artifact §3.5) with the hybrid posture its own last bullet suggested: verbatim episodes are NEVER deleted as space optimization — texture is the product (§3.1).
- **Item 2 "Table Migration"** → absorbed as the evolutionary schema disposition (§3.7): additive-first, no bulk re-extraction backfill.
- **Contrastive retrieval** → superseded by RRF hybrid + deterministic composite scoring (Phases 1a/1b).
- **Knowledge-vs-memory + lore books** → the `canon` type + Phase 6 curation surfaces (§3.1, §5); [`MEMORY_INGESTION_IMPROVEMENTS.md`](../../../docs/proposals/backlog/MEMORY_INGESTION_IMPROVEMENTS.md) remains the ingestion-side input.
- **Per-user quotas** → rides §3.8 cost guardrails + tier aging.
- **Cross-channel retrieval limits** → orthogonal; still live below.

**Implementation phases (pull from artifact §5)**: 0 integrity+eval-baseline (prod visibility-filter fix fast-tracked, already on the board) → 1a hybrid retrieval → 2 typed memories + extraction → 1b composite scoring → 3 scoping pools (consent package) → 4 relationship layer → 5 consolidation → 6 curation/lore books. **Phases 0+1a+2 are the minimum-viable bet; 3–6 are evidence-gated on the eval harness.** Each phase gets plan-mode + council at implementation time.

#### Still-live items not owned by the artifact

- **Cross-channel history — smarter retrieval with limits**: limit messages per channel, prioritize channels with active conversations. Distinct from the user-driven `/history range` import (tracked in Inbox) — this is the automatic retrieval path at generation time.

Design inputs from elsewhere: message-action affordances' history/memory consistency invariant → artifact §3.6/Phase 0; `MEMORY_MANAGEMENT_COMMANDS.md` icebox → absorbed (artifact §6).
