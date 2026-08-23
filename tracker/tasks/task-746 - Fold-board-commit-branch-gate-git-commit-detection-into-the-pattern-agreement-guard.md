---
id: TASK-746
title: >-
  Fold board-commit-branch-gate git-commit detection into the pattern-agreement
  guard
status: To Do
assignee: []
created_date: '2026-08-23 13:54'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 746000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the board-commit-branch-gate hook (#2193) is a third ENFORCING copy of "is this command a git commit" detection, alongside the two copies gitCommitPatternAgreement.test.ts keeps in sync (packages/tooling/src/dev/gitCommitPatternAgreement.test.ts, built after the TASK-441/442 drift incidents). Its bespoke bash regex already diverged once during review (a whole-command commit-tree/commit-graph substring scan the synced copies do not have - removed in-review). The project record says this drift recurs.

Fix shape: extend the agreement test to pin the hook regex against the synced copies (extract the pattern to a greppable single line the test can read, the same mechanism the other bash copy used), or record an explicit documented exemption in the test naming why the hook is allowed to differ.

Acceptance: gitCommitPatternAgreement covers (or explicitly exempts, with reason) board-commit-branch-gate.sh; a deliberate mutation of the hook regex reddens the guard.
<!-- SECTION:DESCRIPTION:END -->
