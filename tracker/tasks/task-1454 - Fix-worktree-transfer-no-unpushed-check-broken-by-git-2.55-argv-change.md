---
id: TASK-1454
title: >-
  worktree:transfer no-unpushed check: add a real-git test (git 2.55 argv
  premise contradicted)
status: To Do
assignee: []
created_date: '2026-11-18T20:01:00Z'
updated_date: '2026-11-20T07:00:00Z'
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

PREMISE CONTRADICTED (2026-11-20, probe on git 2.55.0, main tree on develop with two local commits not yet pushed): `git log --oneline HEAD --not --remotes` printed 2 lines (correct: the two unpushed commits); `git log --oneline --not --remotes HEAD` printed 0 (`--not` also negates the trailing HEAD, so the range is empty). The current order is correct, and the proposed reorder would make the check pass on real unpushed work: the data-loss direction. DO NOT apply the Fix above. A PR 2773 transfer also passed this check on git 2.55.0 on 11-19. The doc-66 refusal is therefore unexplained (candidates: the worktree branch based on a local-only commit, or stale remote-tracking refs before a fetch). Re-scoped work: (1) add a real-git test (temp repo with a bare remote: a clean branch passes, an unpushed commit refuses) because the existing tests mock the argv string and cannot see argv semantics; (2) if a refusal recurs, capture the worktree's `git log --oneline HEAD --not --remotes` output and `git branch -vv` before diagnosing.
<!-- SECTION:DESCRIPTION:END -->
