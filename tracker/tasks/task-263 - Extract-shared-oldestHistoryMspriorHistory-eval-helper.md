---
id: TASK-263
title: 'Extract shared oldestHistoryMs(priorHistory) eval helper'
status: To Do
assignee: []
created_date: '2026-07-13 00:00'
labels:
  - 'origin:review'
dependencies: []
ordinal: 263000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Extract shared `oldestHistoryMs(priorHistory)` eval helper — The "empty history → `Number.MAX_SAFE_INTEGER`, else `Math.min(createdAt…)`" block (incl. the Infinity-serializes-to-null rationale) is duplicated verbatim in `factPooling.eval.test.ts` and `foldAwarePooling.eval.test.ts` — real logic, not call-shape, so it's a clean extraction into a small shared eval module. **Promote when**: next touch of either eval runner. Surfaced 2026-07-13 (#1637 round-2 review).

**Why:** Two copies of real logic in sibling runners; third copy would force it anyway.
<!-- SECTION:DESCRIPTION:END -->
