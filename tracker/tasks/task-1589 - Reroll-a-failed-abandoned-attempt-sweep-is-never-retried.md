---
id: TASK-1589
title: 'Reroll: a failed abandoned-attempt sweep is never retried'
status: To Do
assignee: []
created_date: '2026-11-28T17:41:00Z'
labels:
  - area:api-gateway
  - size:M
  - state:dependent
dependencies: []
priority: medium
ordinal: 1579000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the reroll commit sweeps abandoned attempts memories by the OLD row id after the commit (TASK-1582 PR B, rerollCommit.ts). A crash or error between commit and sweep leaves those memories, and no later commit targets that row id again, so nothing retries.

What: sweep by lineage (successor rows carry the chain), or a periodic sweep over job_results rerollMemory rows whose row is no longer live.

Acceptance: a sweep interrupted after a commit is completed by a later pass; component test.
<!-- SECTION:DESCRIPTION:END -->
