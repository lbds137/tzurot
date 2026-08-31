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

### Relations

- doc-8 (memory overhaul): sibling substrate; memory re-entry (Phase B) lands first.
- doc-11 (next-gen AI): the Lorebooks line migrates here; agentic tools may later query this store.
- doc-67 (tag-scoped sharing): its per-user scoping mechanism is a candidate consumer/pattern.
