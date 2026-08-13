---
id: TASK-595
title: >-
  CI-gate monitor resolves its SHA in the shell cwd, which may be a different
  checkout than the PR branch
status: To Do
assignee: []
created_date: '2026-08-13 23:02'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 595000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the PR-monitoring rule mandates arming the gate with the substitution intact - pnpm ops gh:ci-gate N --sha $(git rev-parse HEAD) - and warns that anything moving HEAD between push and monitor execution makes the gate watch a different SHA in silence. It names one cause: a branch hop. There is a second, and it bit live: the substitution resolves in the PERSISTENT SHELL cwd, so when the branch lives in a git worktree and the shell is sitting in the main checkout, the gate watches the main checkout HEAD - typically develop - and the PR is never watched at all.

Observed shape: arming worked correctly while the shell had cd-ed into the worktree. The very next arming used git -C worktree for the commit and push instead of cd, which left the shell in the repo root. The monitor then resolved develop tip and the gate exited 1 against a SHA with no PR. Nothing local objects, because develop tip is a perfectly real commit - the same silence the rule already describes for the branch-hop case.

This matters more now than it used to: the orchestration skill mandates worktree isolation for every file-mutating worker, so worktree-held branches are the normal case for delegated units rather than an exception.

Fix shape, pick one: (a) one line in 05-tooling.md § PR Monitoring naming cwd alongside branch-hop as a cause, with the concrete instruction to cd into the checkout that holds the branch before arming - cheapest, and it sits exactly where the invocation is already copied verbatim; (b) teach ci-gate to reject a --sha that is not the PR head, which it can already learn from gh pr view N --json headRefOid. That converts a silent mis-watch into an immediate error and is the structural version, since it does not depend on anyone remembering. (b) is strictly better if the extra API call is acceptable; the guard already calls gh.

Note the invocation is triplicated by design (05-tooling.md, the hook heredoc, and the git-workflow skill) and guard:monitor-command fails CI when the copies diverge, so option (a) must not touch the command line itself - only the prose around it.

Acceptance: arming the monitor from the wrong checkout either cannot happen or fails loudly instead of watching an unrelated SHA.

Source: observed 2026-08-13 while merging two PRs whose branches lived in agent worktrees.
<!-- SECTION:DESCRIPTION:END -->
