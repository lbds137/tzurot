---
id: TASK-1598
title: 'Reroll abort: drop on a definite refusal instead of a recovery round'
status: To Do
assignee: []
created_date: '2026-11-28T20:34:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1588000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: review round 8 on #2834 (nit 2). abortReroll folds a definite refused (404/403) into unknown (rerollAbort.ts:36), so abortThenDrop and settleFailedCommit now hand definite refusals to recovery, which re-claims 30s later, gets refused again and drops with a misleading warn.
What: use abortRerollDetailed in those helpers and drop on refused directly with the extra-ids warn recovery uses; or document that unknown includes refusals.
Acceptance: a refused abort drops the record without a recovery hand-off, with a test.
<!-- SECTION:DESCRIPTION:END -->
