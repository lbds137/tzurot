---
id: TASK-1591
title: 'Reroll: a late abort can miss the committing attempt and delete its memory'
status: To Do
assignee: []
created_date: '2026-11-28T18:27:00Z'
labels:
  - area:api-gateway
  - size:M
  - state:dependent
dependencies: []
priority: medium
ordinal: 1581000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Fable r5 review L3 and L4 (docs/local/task-1582/fable-review-r5.md). Two narrow paths where a late abort deletes a live memory with identical text. (a) The abort reads job_results before taking the row lock (rerollAttempt.ts), so a committer whose result lands between that read and the lock is missed. (b) If the successor row was itself rerolled again, the abort finds it soft-deleted and its keep set is empty (rerollJobResult.ts liveSuccessorMemory), so the newest live reply memory can be deleted.
What: (a) when the old row is not live and the pre-read found no live successor, re-read the candidates inside the transaction. (b) follow the lineage to the live descendant row, or keep every id listed by any committed attempt in the lineage.
Acceptance: component tests for both scenarios; the live memory survives.
<!-- SECTION:DESCRIPTION:END -->
