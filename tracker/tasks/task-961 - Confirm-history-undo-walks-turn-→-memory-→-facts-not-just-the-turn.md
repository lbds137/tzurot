---
id: TASK-961
title: 'Confirm /history undo walks turn → memory → facts, not just the turn'
status: Done
assignee: []
created_date: '2026-09-13 17:24'
updated_date: '2026-10-04 23:08'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 958000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: shapes.inc 2026-08-29 fixed "Rewind now removes long-term memories created from the messages you rewound", because a rewound message could vanish from the visible conversation while what was learned from it stayed in long-term memory. Tzurot has the linkage to do better: memories.message_ids carries the trigger message id (memory-architecture Phase 0 R8, "deletion of the source turn propagates to this memory", services/ai-worker/src/services/LongTermMemoryService.ts storeInteraction) and memory_facts.sourceMemoryIds links facts to memories. Whether the undo route actually walks the whole chain — turn deleted, derived memory deleted or invalidated, facts extracted from that memory superseded or dropped — has not been verified; the 2026-09-13 grep of the history routes found only a chunkMessageIds fixture, not the propagation.
Fix shape: read the undo route and the propagation code; write ONE PGLite component test that stores a turn, a memory linked to it, and a fact sourced from that memory, undoes the turn, and asserts the memory and fact state. If the chain is complete, the test is the pin and the task closes. If a link is missing, that is the defect — fix the missing hop in the same PR and say which hop it was.
Acceptance: a component test pins undo propagation across all three layers; the PR body states which hops already worked and which (if any) were added.

ANSWER (read-first grounding 2026-09-21; cites verified against develop dab8deef6): the premise mapped shapes.inc "rewind" onto the wrong route. `/history undo` (services/api-gateway/src/routes/user/history.ts, createUndoHandler at ~169) RESTORES the previous context epoch after a `/history clear` - it swaps lastContextReset and previousContextReset on UserPersonaHistoryConfig and counts the rows made visible again; it deletes nothing, so there is no deletion for it to propagate. Tzurot has two paths that hide or remove turns: `/history clear` (createClearHandler ~83, a soft context reset by epoch; the handler touches no memory or fact table) and `/history hard-delete` (~356, ConversationRetentionService.clearHistory at packages/conversation-history/src/ConversationRetentionService.ts:118-144, which calls propagateDeletionToMemories per batch, and that calls propagateDeletionToFacts - packages/conversation-history/src/memoryDeletionPropagation.ts:47-79 and :107-144). The three-layer chain the task asks to pin IS pinned, on the hard-delete path, by a real-PGLite test: memoryDeletionPropagation.component.test.ts `propagates a message deletion through the full chain: message -> memory -> fact` (line 182), alongside the locked, corrected, forgotten, superseded and self-heal cases. Which hops already worked: all three on hard-delete; none were added. What is NOT pinned and by design: a soft `/history clear` leaves memories and facts learned from the cleared turns live, because clear is a context boundary (a fresh conversation), not a retraction - hard-delete is the retraction tool. That is the shapes.inc concern in Tzurot terms, and it is a product call, so this task moves to the owner queue instead of closing.
<!-- SECTION:DESCRIPTION:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Owner decision 2026-10-04 (AskUserQuestion, chose the recommendation): /history clear stays a reversible context boundary that keeps what was learned; closed on the existing pin. Un-learning goes through hard-delete and /memory deletion, which already propagate. A clear-should-forget build would need resurrect-on-undo specified first.
<!-- SECTION:FINAL_SUMMARY:END -->
