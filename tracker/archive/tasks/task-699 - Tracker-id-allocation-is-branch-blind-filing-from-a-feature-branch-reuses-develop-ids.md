---
id: TASK-699
title: >-
  Tracker id allocation is branch-blind - filing from a feature branch reuses
  develop ids
status: To Do
assignee: []
created_date: '2026-08-20 16:04'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 699000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: four id collisions in one week, all the same mechanism - the CLI allocates the next task id from the LOCAL checkout tree, so filing from a feature branch cut before recent develop task commits reuses ids develop already assigned (TASK-650 filed twice, TASK-648 renumbered to 654, TASK-657 renumbered to 658, TASK-693/694 renumbered to 695/696). Each collision costs a hand-renumber of frontmatter id + ordinal + filename, and an unnoticed one would make two tasks answer to one id in every query.

Fix shape: derive the next id from origin/develop tracker tree instead of (or as a max() with) the local tree - e.g. a wrapper or patch that reads git ls-tree -r --name-only origin/develop -- tracker/tasks/ and takes the max id across both. Alternative cheaper guard: a PreToolUse or pre-commit check that warns when pnpm tracker task create runs on a non-develop branch. Prefer the allocator fix - the guard still allows the collision when origin/develop was not fetched recently, so pair it with a git fetch origin develop or accept that staleness window and say so.

Acceptance: filing a task from a feature branch cut before recent develop task commits allocates an id develop does not already use, pinned by a test against the allocator (or the wrapper); the staleness window, if any remains, is documented in the tool help.

Source: 2026-08-20 session-mining run (SYNTHESIS-2026-08-20 P1, owner-approved).
<!-- SECTION:DESCRIPTION:END -->
