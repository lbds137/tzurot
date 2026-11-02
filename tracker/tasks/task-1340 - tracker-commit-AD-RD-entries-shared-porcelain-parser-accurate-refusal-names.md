---
id: TASK-1340
title: 'tracker:commit: AD/RD entries, shared porcelain parser, accurate refusal names'
status: To Do
assignee: []
created_date: '2026-11-02T05:54:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1323000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: review on PR 2695 left these in packages/tooling/src/dev/tracker-commit.ts. Each fails safe. (1) A board file staged then deleted from disk (status AD, and probably RD) goes to git add, then the commit pathspec fails with a pathspec error, so one leftover entry refuses the whole run with a reason pointing at the commit and not the cause. (2) parsePorcelainZEntries here and parsePorcelainZPaths in unit-closeout.ts have drifted: the new one reads R or C from either XY column and the old one only from X. buildCommitMessage is also copied. (3) A copy entry can be refused as mixed-rename, though a copy leaves its source alone. (4) A failed git status reports check nothing-to-commit or stranded-board-files, which reads as a result rather than an error; merge-base exit 128 reads as behind or diverged. (5) The real-git tests read global git config: commit.gpgsign or core.hooksPath on a dev machine changes them; set GIT_CONFIG_GLOBAL and GIT_CONFIG_NOSYSTEM in cleanGitEnv.

What: handle AD and RD with a real-git test, move the parser and trailer builder to one shared module used by both commands, refuse only R as mixed-rename, give status failures their own check name, and isolate the test config.

Acceptance: a real-git AD case passes; unit-closeout.ts and tracker-commit.ts share one parser.
<!-- SECTION:DESCRIPTION:END -->
