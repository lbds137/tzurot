---
id: TASK-1592
title: 'Reroll: every abort depends on an unindexed job_results scan'
status: To Do
assignee: []
created_date: '2026-11-28T18:27:00Z'
labels:
  - area:api-gateway
  - size:S
  - state:observable
dependencies: []
priority: low
ordinal: 1582000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Fable r5 review L7 of the Reroll PR. Each reroll abort scans job_results by the JSON rerollMemory rowId (rerollJobResult.ts). A slow or failing scan is a 500, which the bot reads as unknown; on the early-exit handler paths nothing retries an unknown abort, so the attempt memories stay. Size is fine today (unmeasured).
What: measure job_results row count and abort latency in prod after beta.253; if it grows, add an expression index on the rowId path or store rowId as a column.
Acceptance: a recorded measurement and either an index migration or a documented no-op decision.
<!-- SECTION:DESCRIPTION:END -->
