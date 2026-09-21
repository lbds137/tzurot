---
id: TASK-961
title: 'Confirm /history undo walks turn → memory → facts, not just the turn'
status: To Do
assignee: []
created_date: '2026-09-13 17:24'
updated_date: '2026-09-21 19:09'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:owner'
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
Owner question: should `/history clear` (the soft reset users reach for as "rewind") also soft-delete the memories and facts derived from the turns it hides, the way hard-delete does, or stay a context boundary that keeps what was learned?
Recommendation: keep clear as a context boundary and close this task on the existing pin - clear is reversible via undo, and invalidating memories on a reversible action would need a matching resurrect on undo (and the digest/archive rows that hang off those memories); users who want the character to un-learn something have hard-delete and `/memory` deletion, both of which propagate. If clear-should-forget is wanted, file it as a build with the resurrect-on-undo half specified.
<!-- SECTION:DESCRIPTION:END -->
