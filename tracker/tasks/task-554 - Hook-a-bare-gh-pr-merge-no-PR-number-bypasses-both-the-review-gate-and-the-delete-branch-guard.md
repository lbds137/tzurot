---
id: TASK-554
title: >-
  Hook: a bare gh pr merge (no PR number) bypasses both the review gate and the
  delete-branch guard
status: To Do
assignee: []
created_date: '2026-08-12 16:13'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 554000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2078 round 4 review. extract() only returns a PR number when a literal digit token follows gh pr merge. With no digit it returns empty, and pr-merge-review-check.sh exits 0 at the "if [ -z $PR_NUM ]" check before either gate runs.

A numberless "gh pr merge --delete-branch" is valid usage - gh resolves the PR from the checked-out branch - and it is arguably the most natural moment to reach for the flag, since you are sitting on the branch you are retiring. In that shape the review gate does not inject the review AND the worktree precondition does not fire.

Scope: this predates the delete-branch guard; the review gate has always had it. That is not a reason to leave it, it is the reason it was never noticed. Not fixed in 2078 because the fix changes the REVIEW GATE for every merge, not just the new guard, and needs its own probe matrix - which is more than a round-4 ride-along should carry.

Fix shape: the tokenizer can already tell the two empty cases apart. adjacent_merge_scan finds gh/pr/merge as three adjacent tokens; if that holds but no digit followed, a real invocation is present with an implicit PR. Emit that as a third signal, then resolve the number with gh pr view --json number (no positional arg resolves from the current branch) - the same call resolve_pr_view already makes. Keep the fail-open posture: an unresolvable implicit PR must allow the merge, never block it.

Landmines: the empty-PR_NUM path is also reached by a command that merely MENTIONS the phrase without invoking it, so the distinguishing signal has to come from adjacency, not from emptiness. Probe cases must cover: bare merge with the flag blocks on conflict, bare merge without the flag still injects the review, a mention-only command still no-ops, and gh pr view failing degrades to allow.

Acceptance: a numberless gh pr merge is gated by both the review gate and the delete-branch precondition, or the gap is ruled out on merit with the reason recorded; the probe pins whichever holds.
<!-- SECTION:DESCRIPTION:END -->
