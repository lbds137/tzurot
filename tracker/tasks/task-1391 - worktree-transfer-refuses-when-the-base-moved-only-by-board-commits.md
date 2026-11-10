---
id: TASK-1391
title: worktree:transfer refuses when the base moved only by board commits
status: To Do
assignee: []
created_date: '2026-11-10T14:24:00Z'
labels:
  - area:tooling
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1374000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: checkBaseUnchanged (packages/tooling/src/dev/worktree-transfer.ts, strict mainHead === base) refuses base-unchanged after a tracker-only commit lands on the main tree branch, forcing a manual patch transfer (11-10, PR 2738). The orchestration skill (.claude/skills/tzurot-orchestration/SKILL.md ~573-577) still says to git switch develop for board commits although ops tracker:commit exists.
What: accept when base is an ancestor of HEAD and base..HEAD touches only isBoardPath files (exported from tracker-commit.ts); real-git tests for both arms. Point the skill at ops tracker:commit.
Acceptance: transfer succeeds across a board-only base move and still refuses on any code change (Fable perf review 2026-11-10, item P6).
<!-- SECTION:DESCRIPTION:END -->
