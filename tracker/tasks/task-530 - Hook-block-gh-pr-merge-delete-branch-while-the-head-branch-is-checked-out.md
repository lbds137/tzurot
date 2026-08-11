---
id: TASK-530
title: 'Hook: block gh pr merge --delete-branch while the head branch is checked out'
status: To Do
assignee: []
created_date: '2026-08-11 19:27'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 530000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: reviewer finding on PR 2066 (round 3, Low/process), and it is correct on the rules own terms. 00-critical Fix Recurring Failures Structurally asks rule then skill then HOOK, and PR 2066 stopped at the skill layer for a failure whose whole premise is that the ordering step is easy to forget. A procedure that depends on someone remembering to read it is the weakest of the three, and this exact class already produced silent survivors across at least three merges in one session before anyone noticed.

What: a PreToolUse hook on gh pr merge, modelled on the existing pr-merge-review-check.sh which already gates that same command. When the invocation carries --delete-branch, resolve the PR head branch and refuse if that branch is checked out anywhere - git worktree list for other trees, git branch --show-current for the main one. The refusal message should name the offending path and the fix (remove the worktree, or switch the main checkout to develop), since the whole point is that the reader does not know the rule yet.

Landmines: the hook must not fire on release PRs, which merge WITHOUT --delete-branch, so gating on the flag being present handles that for free. Resolving the head branch needs a gh call - keep it degrading open rather than blocking a merge when the API is unreachable, the same posture the review-check hook takes. Every hook needs a probe under the check-hook-probes registry (.claude/hooks/*.probe.sh) and the probe is the gate, not an afterthought.

Acceptance: with a worktree holding the head branch, gh pr merge --delete-branch is refused with an actionable message; with the branch checked out nowhere it passes through untouched; probe covers both plus the release-PR no-flag path.
<!-- SECTION:DESCRIPTION:END -->
