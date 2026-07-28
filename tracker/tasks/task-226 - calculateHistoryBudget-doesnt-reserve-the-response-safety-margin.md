---
id: TASK-226
title: calculateHistoryBudget doesn't reserve the response safety margin
status: To Do
assignee: []
created_date: '2026-07-07 00:00'
updated_date: '2026-07-28 10:50'
labels:
  - 'origin:review'
  - 'area:ai-worker'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 226000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`calculateHistoryBudget` doesn't reserve the response safety margin — `ContextWindowManager.calculateHistoryBudget` (~:254) omits the RESPONSE_SAFETY_MARGIN_RATIO subtraction that `calculateMemoryBudget` applies — in the contention case the worst-case sum of prompt+message+memories+history can exceed the window by up to the margin. Bounded upstream by computeContextCap's 50% effective-window cap, so not manifesting; unify the margin accounting when the memory epic's budget refactor touches this (same family as the pre/post-truncation lens). **Promote when**: memory epic Phase 1b budget refactor, or any calculateHistoryBudget touch. Surfaced 2026-07-07 (PR #1530 review).

**Why:** Tightens the same shared-space accounting item 7 fixed.
<!-- SECTION:DESCRIPTION:END -->
