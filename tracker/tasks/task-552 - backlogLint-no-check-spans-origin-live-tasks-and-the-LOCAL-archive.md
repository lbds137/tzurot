---
id: TASK-552
title: 'backlogLint: no check spans origin live tasks and the LOCAL archive'
status: To Do
assignee: []
created_date: '2026-08-12 13:33'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 552000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: review of PR 2077 (round 5). checkOriginIdCollisions compares local tasks against origin/develop live tree only; checkArchivedTasksStillLive is purely local (live vs local archive). Neither covers origin-live vs local-archive, so the PR body claim that the matrix is closed was an overclaim and has been corrected.

The missed sequence: develop archives TASK-N. A branch cut BEFORE that archive-move runs task create; the allocator scans the live directory only, so it re-hands out TASK-N. On that branch no check fires. The collision surfaces post-merge, where checkArchivedTasksStillLive does catch it - so this is a DELAYED catch, not a silent miss.

The obvious fix is WRONG and that is the reason this needs design rather than a one-liner. Adding tracker/archive/tasks to the origin ls-tree pathspec makes every un-rebased branch fail: a branch that predates the archive-move legitimately still has the task live, its path is absent from origin live, and the id is present in origin archive - the exact shape of a real collision. The check cannot tell not-yet-rebased from recycled-id by filenames alone.

Fix shape (needs design): distinguish the two states, most likely by asking whether the local live file is byte-identical to the archived one on origin, or by comparing merge-base rather than origin head. Either is a real design step.

Acceptance: either the gap is closed with a check that does not fire on an un-rebased branch, or it is ruled out on merit with the delayed-catch argument recorded.
<!-- SECTION:DESCRIPTION:END -->
