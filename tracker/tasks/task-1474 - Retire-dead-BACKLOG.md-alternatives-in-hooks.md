---
id: TASK-1474
title: Retire dead BACKLOG.md alternatives in hooks
status: To Do
assignee: []
created_date: '2026-11-20T04:02:00Z'
updated_date: '2026-11-20T05:54:00Z'
labels:
  - area:hooks
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1474000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2772 retired the root BACKLOG.md load manifest; three hooks still carry BACKLOG.md handling alternatives that can no longer fire from a live manifest.

What: in board-commit-branch-gate.sh, cwd-drift-guard.sh and skill-eval.sh, read each BACKLOG.md branch, confirm it is dead (a retired manifest can never reach it), remove it, and run each affected hook probe via guard:hook-probes.

Acceptance: no BACKLOG.md alternative remains in .claude/hooks or .husky scripts; all registered probes green; live-path behavior unchanged.

Owner question: remove the dead BACKLOG.md alternatives from the three hooks now that the manifest is retired?

Recommendation: yes — dead branches in load-bearing hooks mislead the next editor, and the probe registry makes the removal verifiable.
Owner ruling (2026-11-20, AUQ): yes, remove the dead BACKLOG.md alternatives (the recommendation). Same PR: drop the "(TASK-1467 owns the physical alignment, owner-gated)" parenthetical in `.claude/rules/06-backlog.md` § Structure; TASK-1467 was ruled out 11-20 (keep tracker/).
<!-- SECTION:DESCRIPTION:END -->
