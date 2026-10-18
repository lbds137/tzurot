---
id: TASK-1245
title: >-
  PR 2629 review-cap residue: misleading chunkIndex on the tooling insert, stale
  router docs
status: To Do
assignee: []
created_date: '2026-10-18 18:12'
labels:
  - 'area:memory'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1233000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2629 (TASK-1230) merged at the six-round review cap with three low findings open from the last review; none affects behavior.

What:
1. packages/tooling/src/memory/memory-row-insert.ts and backfill-ltm.ts: the optional chunkIndex field on MemoryRowInsert and MemoryPair is never set by a caller and is not written to the chunk_index column; it only gates the trace. Drop it and its test arm (these tooling inserts never chunk), or rename it to isFirstChunk.
2. services/bot-client/src/commands/memory/detailActionRouter.ts header docstring still lists five actions and an 8-case switch; it now dispatches nine actions, five through the MEMORY_ID_ACTIONS table.
3. Same file: the MEMORY_ID_ACTIONS comment says each handler returns true; the router does.

Declined at review (recorded so it is not re-raised): returning a hasReasoning flag in place of the full trace on single-memory responses (a few KB per detail click on the internal hop, no measured cost); a user-facing note that a trace belongs to the original reply after an edit (owner ruled to keep the trace on edit, 2026-10-18). Checked: account deletion removes pending_memory rows (AccountDeletionService pendingMemory.deleteMany), so the trace copy in pending-memory metadata is covered.

Acceptance: the three edits land with tests green.
<!-- SECTION:DESCRIPTION:END -->
