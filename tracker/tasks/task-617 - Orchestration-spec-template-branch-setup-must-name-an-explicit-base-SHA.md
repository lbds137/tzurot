---
id: TASK-617
title: 'Orchestration spec template: branch setup must name an explicit base SHA'
status: To Do
assignee: []
created_date: '2026-08-15 13:41'
labels:
  - 'area:skills'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 617000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: isolation:"worktree" cuts the agent worktree from main, NOT from the orchestrator current branch. Verified 2026-08-15: a worker dispatched from develop (8095007d3) got a worktree based on 5b3870dfa, byte-identical to origin/main, 55 commits behind, missing both prerequisite PRs the spec named. It fails silently, since a stale base still compiles and the worker correctly reports that the spec describes files that do not exist.

Fix shape: /tzurot-orchestration section 7 of the spec template currently says the branch setup is a bare `git checkout -b <branch>`. Change it to require an explicit start-point, `git checkout -b <branch> <base-sha>`, plus a line in section Worktree spawns stating the cut point is main and that the dispatch prompt must carry the intended base SHA for the worker to verify with git log -1 before its first edit. This removes the failure mode rather than relying on the worker catching it.

Acceptance: the skill names the main cut point, section 7 shows the explicit start-point form, and the base-SHA statement is part of the dispatch contract rather than an ad-hoc addition.

WIDENED after a second, distinct failure the same day: isolation does not reliably PERSIST for a worker's lifetime either. On the doc-73 PR 2 dispatch the agent worktree existed and was locked at the start of a resumed run, and had been removed by the time the worker ran its branch command, so that command moved the ORCHESTRATOR's main checkout instead. The worker then correctly reported it was no longer isolated. Two separate defects, one dispatch: cut-from-main (above) and vanished-mid-run.

Consequence for the contract: checking git worktree list once after dispatch is NOT sufficient, because it was true when checked and false later. The orchestrator must re-verify at every interaction with a file-mutating worker, and the worker's own contract should require it to re-check before any command that moves a branch.

Do NOT fix this by never resuming workers. That was the first hypothesis and it is wrong: the worktree vanished mid-run, not at resume, so a fresh dispatch is exposed to the same disappearance.
<!-- SECTION:DESCRIPTION:END -->
