---
id: TASK-78
title: 'satisfies constraint on PgvectorMemoryDocument'
status: To Do
assignee: []
created_date: '2026-04-30 00:00'
labels:
  - 'area:db'
dependencies: []
ordinal: 78000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`satisfies` constraint on `PgvectorMemoryDocument`

**Why:** The implicit `PgvectorMemoryDocument[]` → `MemoryDocument[]` (RAG-layer) assignment at `MemoryRetriever.ts:~221` works today via TypeScript structural-typing widening — `Record<string, unknown>` narrows into `{ id?, createdAt?, score? }` because all RAG-layer metadata fields are optional. Risk: if `MemoryDocument.metadata` ever gains a **required** field, the type error surfaces at the assignment site (consumer) rather than at the type definition (producer). An explicit `satisfies` constraint would make the contract fail-fast at definition time. **Fix shape**: declare a structural-compatibility witness type (e.g., `PgvectorMemoryDocument satisfies StorageNarrowsToRag`) — concrete encoding TBD; needs design pass on whether to express the invariant at the type level or via a compile-time test in `*.test-d.ts`. **Promote when**: `MemoryDocument.metadata` (in `ConversationalRAGTypes.ts`) gains a required field, OR opportunistically when next touching the storage→RAG seam in `MemoryRetriever`. Surfaced 2026-04-30 PR #948 round 3. Deferred 2026-05-01.
<!-- SECTION:DESCRIPTION:END -->
