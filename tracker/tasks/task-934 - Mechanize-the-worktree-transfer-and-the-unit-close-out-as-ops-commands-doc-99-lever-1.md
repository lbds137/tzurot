---
id: TASK-934
title: >-
  Mechanize the worktree transfer and the unit close-out as ops commands (doc-99
  lever 1)
status: Done
assignee: []
created_date: '2026-09-10 23:24'
updated_date: '2026-09-12 06:05'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 932000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the doc-99 phase measurement over the two most recent Fable windows found the bookkeeping around a unit (PR, review rounds, transfer, close-out) at 72.6 percent of main-loop calls and 48.3 percent of weighted spend in the orchestrated window, against 8.1 percent for the dispatch calls and 19.4 percent for spec writing. Each main-loop call re-reads the whole context, so this is the dominant cost term. The safety checks are already specified in the orchestration skill; the command is a transcription.
Fix shape: (1) pnpm ops worktree:transfer <path> [--branch <name>] runs, in order: add -A in the worktree, diff --cached to a patch, apply --index in the main tree, byte-compare the staged diff to the patch, porcelain-vs-patch (nothing outside), no-unpushed-commits (log --not --remotes and log <base>..HEAD empty), then unlock, remove --force, branch -D; refuses on any failure with the reason and prints a one-screen verdict. (2) pnpm ops unit:closeout <task-id> --pr <n> --sha <merge-sha> marks the task Done, prints the now.md and CURRENT.md lines it cannot write (those need judgment), then commits and pushes the tracker file to develop. Both live in packages/tooling/src/dev/ with colocated tests and OPS_CLI_REFERENCE rows.
Acceptance: a unit transfer is one main-loop call instead of the measured ten to fifteen; the command refuses on each of the three safety checks in a test; the orchestration skill transfer paragraph points at the command.
<!-- SECTION:DESCRIPTION:END -->
