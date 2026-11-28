---
id: TASK-1596
title: 'Reroll: unknown abort before the in-flight record leaks the attempt memories'
status: To Do
assignee: []
created_date: '2026-11-28T20:34:00Z'
labels:
  - area:bot-client
  - size:M
  - state:ready
dependencies: []
priority: high
ordinal: 1586000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: review round 8 on #2834. On every reroll exit that runs before writeInflight (generation failed with memories reported, too-long content, each editInPlace refusal before writeInflight, the throw path with pending null, handleUnknownRerollResult) the abort outcome is ignored and finally deletes the job record. When the abort answers unknown (gateway unhealthy, likely when the recheck also 5xx), the attempt memories the worker wrote stay normal for a reply never delivered, and nothing is left for recovery to retry.
What: on an unknown abort, keep a minimal in-flight record (no chunks, editedCount 0) and handOffToRecovery, or add an abort-retry timer keyed off the job record. Recovery loadDiscordState returns gone/settled once the abort answers.
Acceptance: a test where recheck 500 plus abort 500 leaves a record recovery acts on, and recovery then aborts and drops it. Lila 11-28: first in beta.254 alongside TASK-1585, its own reviewed PR.
<!-- SECTION:DESCRIPTION:END -->
