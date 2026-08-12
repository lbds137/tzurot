---
id: TASK-550
title: Backlog gate does not catch a task present in both tasks and archive
status: To Do
assignee: []
created_date: '2026-08-12 10:07'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 550000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-544 was archived, but a later git reset plus branch checkout during a commit-guard recovery restored the file from HEAD. The result was the same task living in tracker/tasks and tracker/archive/tasks at once — still MEDIUM priority in every open-pool query, while the operator believed it superseded. pnpm ops backlog passed the whole time. Found by hand during PR 2072, not by the gate.

This is the failure the gate already exists to catch: 06-backlog notes that a missing label is indistinguishable from absent work, and the same logic applies here in reverse — an archived task that is still live is indistinguishable from one that was never archived. Nothing surfaces it, because both copies parse fine and each directory looks correct on its own.

What: add a check to the backlog gate asserting that no basename appears in both tracker/tasks and tracker/archive/tasks. One directory listing each and a set intersection; the whole check is a few lines. Hard-fail with the duplicated ids named, consistent with every other finding the gate reports.

Note the trigger is not exotic. Any sequence that unstages a move and then changes branches restores the deleted half, and the archive half is already committed by then. The CLI is not at fault, which is exactly why a structural check is the right home rather than a note telling people to be careful.

Acceptance: a task file present in both directories fails pnpm ops backlog, naming the id.
<!-- SECTION:DESCRIPTION:END -->
