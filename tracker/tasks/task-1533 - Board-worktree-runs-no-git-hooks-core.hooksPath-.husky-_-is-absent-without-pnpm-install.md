---
id: TASK-1533
title: >-
  Board worktree runs no git hooks: core.hooksPath .husky/_ is absent without
  pnpm install
status: To Do
assignee: []
created_date: '2026-11-24T17:53:00Z'
labels:
  - area:hooks
  - size:S
  - state:ready
dependencies: []
priority: high
ordinal: 1530000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: core.hooksPath is the relative .husky/_, which husky generates only on pnpm install. The develop-board worktree (.claude/worktrees/develop-board, where every board commit to develop is made) was never installed, so git finds no hooks there: commit-msg (session-URL block, commitlint), pre-commit and pre-push (lines:check, backlog:lint, guard:proposal-links) all silently skip. Observed 2026-11-24: commit 65fe5931a pushed CURRENT.md at 106 lines against the 105 budget with no local refusal; the board-only push skipped CI lint, so the first failure surfaced on the release PR (#2804) via develop CI run 45451584567, fixed by 46626edb1.

What: make board checkouts run the hooks, failing closed. Options: pnpm install in develop-board (also gives tsx, so pnpm ops runs there), or a session-start/worktree-creation check that refuses a board worktree lacking .husky/_. Verify with a probe: a 106-line CURRENT.md commit from the board worktree is refused at push.

Acceptance: a commit and push from the board worktree runs commit-msg and pre-push; a budget-breaking board push is refused locally.
<!-- SECTION:DESCRIPTION:END -->
