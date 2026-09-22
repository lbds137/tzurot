---
id: TASK-1047
title: >-
  Mining run 3 PR C: four one-line mechanics in 05-tooling and
  10-working-posture
status: Done
assignee: []
created_date: '2026-09-22 18:21'
updated_date: '2026-09-22 19:45'
labels:
  - 'area:rules'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1041000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: session-mining run 3 (2026-09-22): four mechanics each cost or nearly cost a cycle in the window and none is stated by an existing rule. Owner adopted R6 on 2026-09-22.
Fix shape, one sentence each: (1) .claude/rules/05-tooling.md § PR Monitoring - get the checkout off the PR head branch before gh pr merge --delete-branch and VERIFY the remote branch was deleted, the flag fails silently otherwise; (2) same section - when the target branch has moved under a long-lived feature branch, re-derive diffstat and number claims against the MERGE-BASE, not the target branch current HEAD; (3) same section - the merge is the tail of a verify-then-merge && chain, never a bare gh pr merge, so a verification bug halts before the destructive step; (4) .claude/rules/10-working-posture.md § Presence-then-test after bulk edits - a line number computed before any intervening edit to the same file is stale; re-locate the target by content.
Acceptance: the four sentences present; pnpm ops lines:check within the rules budget (2203/2353 lines, 166630/178630 bytes before this change).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shipped as #2474 (merged 2026-09-22). Three of the four sentences landed. The --delete-branch sentence was dropped: a live probe (throwaway PR #2476) showed gh pr merge --rebase --delete-branch run from the head branch exits 0, switches to the base, and deletes the head branch locally and on the remote.
<!-- SECTION:NOTES:END -->
