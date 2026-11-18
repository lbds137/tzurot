---
id: TASK-1454
title: Fix worktree:transfer no-unpushed check broken by git 2.55 argv change
status: To Do
assignee: []
created_date: '2026-11-18T20:01:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1454000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
git 2.55.0 changed argv semantics: git log HEAD --not --remotes no longer excludes remote-reachable commits and prints the full history, while the reordered git log --not --remotes HEAD still excludes correctly. checkNoUnpushedRemotes at packages/tooling/src/dev/worktree-transfer.ts:223 (verify the line before editing, cites drift) uses the broken order, so on git 2.55.0 every transfer refuses with no-unpushed-remotes even on a clean tree; the doc-66 unit had to use the manual transfer path (patch + apply + cmp + git cherry). This is a regression of the TASK-1019 fix under the new git. Fix: reorder the argv in checkNoUnpushedRemotes, sweep packages/tooling for other users of the same order, and if the tool has tests pin both directions (clean tree passes, real unpushed commit refuses). Acceptance: worktree:transfer succeeds on a clean worktree under git 2.55.0 and still refuses a branch with a genuine unpushed commit.
<!-- SECTION:DESCRIPTION:END -->
