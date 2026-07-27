---
id: TASK-328
title: '"deletion means deletion" (R8) is implemented for Memory but not for MemoryFact.…'
status: To Do
assignee: []
created_date: '2026-07-26 00:00'
labels:
  - 'area:ai-worker'
  - 'origin:review'
dependencies: []
ordinal: 328000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-26 (#1796 review, non-blocking) — **"deletion means deletion" (R8) is implemented for `Memory` but not for `MemoryFact`.** `MemoryFact.sourceMemoryIds` links a fact to the memories it was extracted from, and `memory_facts.visibility` + `is_locked` exist with the same semantics as `Memory` — but **`sourceMemoryIds` is only ever WRITTEN** (by the extraction pipeline: `FactStore`, `FactExtractionService`, `ExtractionTrigger`); verified that **no deletion path anywhere reads it**. So a soft-deleted memory leaves its derived facts at `visibility='normal'`, and `FactStore`'s retrieval (`AND f.visibility = 'normal'`) keeps serving them. **Broader than the PR that surfaced it**: this affects EVERY memory-deletion path — `/memory delete`, `/memory purge`, and the new `/history purge` propagation alike — so it is pre-existing, not introduced by #1796. **Fix shape**: cascade on `sourceMemoryIds` overlap when memories are soft-deleted, mirroring `propagateDeletionToMemories` (facts have their own `isLocked`, so the same pin-outranks-deletion carve-out applies). **Two questions to answer first**: (a) is a fact derived from several memories retired when ONE source dies, or only when all do — a fact is a distillation, not a copy; (b) facts already have their own management surface (`/memory facts` + the `memoryFacts.ts` delete routes), so does memory deletion cascading to them surprise a user who curated facts independently? **Promote when**: a user reports a character recalling something after a memory delete (the fact layer is the remaining path), or the next substantial touch to fact extraction/retrieval.

**Why:** Deferred on mechanism + breadth, not origin: different service (ai-worker owns extraction), different retrieval path, and the semantic question in (a) needs an owner answer before any cascade is safe to write.
<!-- SECTION:DESCRIPTION:END -->
