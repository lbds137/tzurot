---
id: TASK-1216
title: >-
  board-commit-branch-gate judges the hook checkout even for a commit in another
  directory
status: Done
assignee: []
created_date: '2026-10-11 22:52'
updated_date: '2026-10-12 01:37'
labels:
  - 'area:hooks'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1205000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: board-commit-branch-gate.sh reads only line 1 (the switch target) of lib/branch_switch.py, so for `git -C <other worktree> commit` or `cd <other worktree> && git commit` it judges the checkout the hook runs in. That over-blocks a board commit made in a develop worktree from a feature checkout, and under-blocks a board commit made in a feature worktree from a develop checkout (the commit strands on the feature branch). Found by the TASK-1209 orchestrator, which read the gate (`read -r SWITCH_TARGET <<< "$LEADING"`).

What: read line 2 (commit dir) and line 3 (others inert) the way develop-code-commit-guard.sh does: re-point the branch read at a sibling worktree of this repo, stay silent for a different repository when inert, and block on the unreadable sentinel. Copy the whole mechanism, not one line.

Acceptance: board probe rows for git -C into a develop sibling (passes), git -C into a feature sibling (blocks), and the sentinel (blocks).
<!-- SECTION:DESCRIPTION:END -->
