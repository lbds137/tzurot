---
id: TASK-1399
title: >-
  Enforce release:develop-ci from a release command instead of a manual skill
  step
status: To Do
assignee: []
created_date: '2026-11-10T21:55:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1382000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: since PR 2739, a board-only develop tip reports every required CI context as skipped-green, so the release PR checks no longer prove the shipped code is green. The only stand-in is `pnpm ops release:develop-ci`, a prose step in .claude/skills/tzurot-git-workflow/SKILL.md (release preflight); nothing runs it, so a release can pass every check while the last develop code run is red or still running (claude-review round 5 on PR 2739, finding 1).
What: call checkDevelopCi() (packages/tooling/src/release/develop-ci.ts) from a command the release flow already requires (release:premigrate runs on every release; deploy:watch-check is the other candidate) and refuse on a non-zero exit with its message; or add a board-only-run CI job with actions: read that fails the tip run. Update the skill line.
Acceptance: a release cut whose last develop code run is not completed-success is refused by a required release command, with a test.
<!-- SECTION:DESCRIPTION:END -->
