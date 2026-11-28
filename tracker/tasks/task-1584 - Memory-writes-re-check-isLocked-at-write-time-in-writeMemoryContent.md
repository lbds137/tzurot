---
id: TASK-1584
title: 'Memory writes: re-check isLocked at write time in writeMemoryContent'
status: To Do
assignee: []
created_date: '2026-11-28T04:52:00Z'
labels:
  - area:api-gateway
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1574000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: rewriteExchangeMemory (Edit Response) and handleUpdateMemory both read isLocked and then call writeMemoryContent (services/api-gateway/src/routes/user/memorySingle.ts) without re-checking, so a lock landing between the read and the write is overwritten. Raised by claude-review on PR 2833 finding 7.
What: make the write conditional (updateMany where id and isLocked false, count 0 means locked or gone) and surface that to both callers.
Acceptance: a unit test where the memory locks between read and write leaves the content unchanged and the caller reports not-updated.
<!-- SECTION:DESCRIPTION:END -->
