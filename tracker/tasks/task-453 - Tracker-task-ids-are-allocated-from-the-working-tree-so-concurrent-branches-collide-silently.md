---
id: TASK-453
title: >-
  Tracker task ids are allocated from the working tree, so concurrent branches
  collide silently
status: To Do
assignee: []
created_date: '2026-08-07 00:54'
updated_date: '2026-08-07 12:33'
labels:
  - 'area:process'
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 452000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Observed live on 2026-08-06. The Backlog.md CLI picks the next task id by scanning tracker/tasks/ in the CURRENT working tree. Tasks filed on an unmerged branch are therefore invisible to any other branch, so two branches that both file a task get the SAME id.

Concrete instance: TASK-451 was filed on branch docs-monitor-stop-prior (canonical CI-monitor command hand-synced across three surfaces). Later the same evening, filing from branch refactor-ops-cli-usage-errors produced a DIFFERENT task, also numbered 451, because the first one did not exist in that working tree. Both would have merged to develop carrying id 451. Caught by hand and renumbered to 452; nothing mechanical would have caught it.

Why the existing gate does not help: pnpm ops backlog validates the tree it can see. Each branch parses cleanly in isolation — the collision only exists in the union, which no single check ever evaluates. Post-merge the two files coexist with duplicate ids, and every id-based query (task edit, task view, cross-references from other tasks) becomes ambiguous.

This will recur whenever work happens on two branches at once, which on this project is routine. Five tasks were filed across three branches that single evening.

Fix shapes to consider:
- Allocate ids against origin/develop plus the local tree, not the local tree alone, so an unmerged sibling branch is still counted.
- Add a duplicate-id check to pnpm ops backlog that runs against the MERGE RESULT rather than the working tree — e.g. compare local task ids against origin/develop and fail on a reused id.
- Drop sequential ids entirely in favour of something collision-free.

The second option is the cheapest and catches the case at push time, which is where it matters, but it does not prevent two in-flight branches from both claiming an id before either merges.

Acceptance: filing a task on a branch while a sibling branch holds an unmerged task cannot produce a duplicate id, or the duplicate is caught before it reaches develop.
<!-- SECTION:DESCRIPTION:END -->
