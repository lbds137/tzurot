---
id: TASK-1301
title: >-
  Dedupe the mirrored run-planning block in the memories and facts batch confirm
  handlers
status: To Do
assignee: []
created_date: '2026-10-26T21:45:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1287000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2667 review round 3. After the shared lockableBatchOutcome.ts extraction, handleBatchConfirm (services/bot-client/src/commands/memory/factsBatch.ts) and handleMemoryBatchConfirm (memoriesBatchConfirm.ts) still mirror about 30 lines with no noun-specific copy: lockedIds from labels, the lock-only unverifiableIds, the runIds filter, labelFor (truncate + escape), runOptions, the resultLines map, the ids.map with buildSkippedLockableLine, and countLockableBatchLines, plus word-for-word comments on the gone and unverifiable rules that will drift. CPD passes today. What: extract planLockableRun(ids, resolved, isLockRun) returning runIds and lockedIds, and assembleLockableLines(ids, results, skips, labelFor, runOptions), into lockableBatchOutcome.ts with unit tests; both handlers call them. Owner ruling 2026-10-26: deferred out of PR 2667 at its review round 3. Acceptance: one copy of each rule and its comment; existing facts, memories and seam tests pass unchanged.
<!-- SECTION:DESCRIPTION:END -->
