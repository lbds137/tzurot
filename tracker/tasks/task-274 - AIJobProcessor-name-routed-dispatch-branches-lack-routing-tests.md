---
id: TASK-274
title: 'AIJobProcessor name-routed dispatch branches lack routing tests'
status: To Do
assignee: []
created_date: '2026-07-15 00:00'
labels:
  - 'origin:review'
dependencies: []
ordinal: 274000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

AIJobProcessor name-routed dispatch branches lack routing tests — The `job.name ===` dispatch for ShapesImport/ShapesExport/AccountExport has no test asserting a job with each name reaches its processor (flagged #1653 r2; pre-existing class for the shapes branches — merits: a mis-route fails silent-weird, and the seam rule wants the routing asserted). **Fix shape**: table-driven unit test in AIJobProcessor.test.ts with the three processors mocked, asserting each name dispatches to the right wrapper. **Promote when**: next AIJobProcessor touch. Surfaced 2026-07-15 (#1653 r2).

**Why:** Three-line dispatch, three-line test each — cheap insurance on a growing switch.
<!-- SECTION:DESCRIPTION:END -->
