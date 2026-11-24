---
id: TASK-1520
title: release:finalize and release:publish break on ordinary checkout states
status: To Do
assignee: []
created_date: '2026-11-24T01:29:00Z'
labels:
  - area:tooling
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1520000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the beta.249 cut hit two avoidable failures. (1) release:finalize runs git checkout develop in the main tree; when a worktree (develop-board) holds develop, git refuses (fatal: develop is already used by worktree) and finalize dies mid-sequence after already checking out main (packages/tooling/src/release/finalize.ts runCheckoutRebasePushSequence). Workaround used: run finalize from inside the worktree holding develop. That workaround also fails when the main tree holds main (seen after the PR 2794 merge): the first step, git checkout main, refuses with fatal: main is already used by worktree. Neither checkout works while both branches are held by different trees; the manual equivalent was git rebase origin/main plus git push --force-with-lease origin develop, run in the develop-holding worktree. Finalize also does not need either checkout: it can rebase in whichever tree holds develop against origin/main, with no local main sync at all. (2) release:publish pushes the tag from the current checkout; .husky/pre-push judged the branch-name pattern against a detached HEAD and refused the tag push (publish.ts ensureTagPushed). Same seam as TASK-678 (pre-push reads HEAD, not the pushed ref).

What: finalize locates the worktree that holds develop (git worktree list --porcelain) and runs the rebase there, or rebases via a temporary detached worktree; pre-push skips the branch-name check for tag-only pushes.

Acceptance: finalize succeeds with develop checked out in another worktree; publish succeeds from a detached HEAD; both pinned by tests.
<!-- SECTION:DESCRIPTION:END -->
