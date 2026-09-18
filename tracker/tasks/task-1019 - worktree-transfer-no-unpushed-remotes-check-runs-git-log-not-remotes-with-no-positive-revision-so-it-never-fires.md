---
id: TASK-1019
title: >-
  worktree:transfer no-unpushed-remotes check runs git log --not --remotes with
  no positive revision, so it never fires
status: To Do
assignee: []
created_date: '2026-09-18 16:48'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1015000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: checkNoUnpushedRemotes in packages/tooling/src/dev/worktree-transfer.ts runs git log --oneline --not --remotes without a positive revision; with no tip to walk from git prints nothing unconditionally (measured in a scratch repo: 0 with two unpushed commits, 2 with HEAD --not --remotes). The check therefore always passes. The tool is degraded rather than unprotected: the sibling checkNoUnpushedBase (mainHead..HEAD) is a correct positive-range check that still refuses on commits past the base, which is the worktree data-loss case. The same dead form in /tzurot-git-workflow § Before merging is fixed by the mining PR that found it.
Fix shape: add HEAD as the positive revision in checkNoUnpushedRemotes; extend worktree-transfer.test.ts with a fixture holding one unpushed commit on a branch whose remote tracking ref exists, asserting the check refuses; keep the base check unchanged.
Acceptance: the new test reds with the old command and greens with HEAD; existing transfer tests pass.
<!-- SECTION:DESCRIPTION:END -->
