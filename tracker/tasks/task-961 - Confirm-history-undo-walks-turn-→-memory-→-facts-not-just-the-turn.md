---
id: TASK-961
title: 'Confirm /history undo walks turn → memory → facts, not just the turn'
status: To Do
assignee: []
created_date: '2026-09-13 17:24'
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
<!-- SECTION:DESCRIPTION:END -->
