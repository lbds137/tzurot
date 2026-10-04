---
id: doc-88
title: 'Theme: Knowledge Store (pgvector substrate)'
type: other
created_date: '2026-08-31 02:12'
---

### Theme: Knowledge Store (pgvector substrate)

_Focus: a general knowledge substrate backed by pgvector, sibling to the memory system — deliberately scoped BROAD at filing (owner call 2026-08-31: "both / broader"), narrowed at design time._

**Owner-initiated 2026-08-31** ("a knowledge store backed by pgvector like the memory system"). Phase C of the ratified roadmap (cold/queue.md) — gated behind the observability epic (doc-12) and sequenced to CONSUME the memory epic's retrieval learnings, not to run beside it.

### Candidate scope (union — design pass narrows)

- **Character lorebooks / documents**: per-character (or shared) knowledge bases — uploaded docs/lore retrieved into context. Absorbs the doc-11 "Lorebooks / Sticky Context" line (keyword-triggered injection is the degenerate no-embedding case; decide at design whether keyword and vector tiers coexist).
- **Cross-character world knowledge**: a shared world/canon store multiple characters draw from, distinct from per-user memories.
- **Anything else RAG-shaped** the design pass surfaces (e.g. the doc-11 web-fetch tool writing fetched pages into a store).

### Design inputs recorded at filing

- **The memory eval harness is the instrument** (memory-architecture.md §3.9): it refuted three plausible retrieval builds (RRF, fold, composite) — point the same gate at every retrieval decision here before building. The refuted-RRF record and the parked FTS index (`feat/memory-hybrid-retrieval`, salvage notes in doc-8) are prior art.
- **Scoping is the hard part, not the vectors**: the memory epic's scoping-matrix questions (per-user vs per-character vs global; sharing semantics) recur here in a different shape. Read doc-8 phase 3 notes before designing.
- **Storage tier**: durable tier-3 by definition (user-authored knowledge outlives any conversation) — the durability-tiers doc governs.
- Council pass before plan-mode (standard for substantial picks); likely a design boulder given it is a new subsystem.

### Owner direction 2026-10-04 — card field limits make character knowledge concrete

Owner (relayed verbatim by the Characters session): _"the character card field limits are why I need to ensure that somewhere in the Tzurot session's backlog there is something about adding knowledge as a vector-indexed thing, so a character can pull in additional knowledge as needed"_. This entry is that something. The same message reframes the memory epic (doc-8 § OWNER DIRECTION 2026-10-04): the facts/memories split is muddled and the epic should aim at a refined, cognition-like knowledge/memory system, cost-effectively.

Evidence from the card-side audit (2026-10-04, kept in the owner's private character-cards repo):

- `PersonalityCreateSchema` caps `characterInfo` and `conversationalExamples` at 4,000 characters. 32 dev-DB cards were over it; originals ran to 6,082 (Rumi characterInfo) and 6,518 (Vepar conversationalExamples).
- Fitting them cost content: 3 downgrades and 19 minor losses across 43 rewritten fields; six cards still have lore lines that fit nowhere (audit § Still gone from the card).
- `conversationalExamples` is the worst case: Vepar kept 1 of 7 example scenarios, Stolas 3 of 6. Dropped scenarios are exactly retrieve-when-relevant material.
- Ready eval corpus: the full pre-limit text of every field is preserved in that repo's history.

Sequencing: this does not move doc-88 by itself. The design question it raises (where character knowledge sits relative to episodes and facts) belongs in the doc-8 re-entry HLD, so the boundary is drawn once. Whether doc-88's Phase C position should change is an owner call to raise when doc-8 re-enters.

### Relations

- doc-8 (memory overhaul): sibling substrate; memory re-entry (Phase B) lands first.
- doc-11 (next-gen AI): the Lorebooks line migrates here; agentic tools may later query this store.
- doc-67 (tag-scoped sharing): its per-user scoping mechanism is a candidate consumer/pattern.
