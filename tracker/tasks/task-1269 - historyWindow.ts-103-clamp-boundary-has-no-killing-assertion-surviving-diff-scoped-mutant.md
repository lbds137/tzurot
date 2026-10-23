---
id: TASK-1269
title: >-
  historyWindow.ts:103 clamp boundary has no killing assertion (surviving
  diff-scoped mutant)
status: To Do
assignee: []
created_date: '2026-10-23 17:07'
labels:
  - 'area:conversation-history'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1257000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the TASK-673 demonstration run (Stryker over historyWindow.ts:99-111, the 0d195f277 channel-history quantization) left 1 survivor: the boundary at :103, inScopeCount <= effectiveCap || chunk === 0. No test kills a mutation of that boundary condition — the clamp's edge case (exactly at the cap, or the empty-chunk guard) is unpinned.

What: add a test that fails when the boundary flips (<= vs <, or chunk === 0 removed), in packages/conversation-history colocated with historyWindow. Then re-run the demonstration range: pnpm --filter @tzurot/conversation-history exec stryker run -m 'src/historyWindow.ts:99-111' --allowEmpty and confirm 0 survivors.

Acceptance: the scoped run over :99-111 reports 0 survived.
<!-- SECTION:DESCRIPTION:END -->
