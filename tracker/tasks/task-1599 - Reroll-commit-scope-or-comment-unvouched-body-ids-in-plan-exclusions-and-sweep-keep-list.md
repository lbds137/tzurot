---
id: TASK-1599
title: >-
  Reroll commit: scope or comment unvouched body ids in plan exclusions and
  sweep keep-list
status: To Do
assignee: []
created_date: '2026-11-28T20:34:00Z'
labels:
  - area:api-gateway
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1589000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: review round 8 on #2834 (nit 4). On the body-ids fallback, attemptMemoryIds from the body still feed excludeMemoryIds for the removal plan and keepMemoryIds for the abandoned-attempt sweep (historyReroll.ts planCommit, sweepAfterCommit). Not a security issue (worst case a crafted body keeps the old reply memories live), but the same trust-the-body seam the revive scope closed.
What: limit both uses to vouched ids, or add a comment saying why only the revive needs the owner scope.
Acceptance: either change with a test, or the comment at the call site.
<!-- SECTION:DESCRIPTION:END -->
