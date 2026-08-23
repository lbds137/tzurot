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

Members folded in from the #2193 round-7 review (reviewer: none block merge; all fail toward missed-block, never wrong-block):
- The -a/-am/--all auto-stage detection scans the WHOLE stripped command, so `git branch -a && git commit` false-triggers it and a dirty unrelated file can turn a board-only commit into a spurious pass. Fix by scoping flag detection to the matched commit invocation (natural once detection is unified), or name it in KNOWN GAPS if unification lands first. Add the probe case.
- lib/shell_quotes.py's CONSUMERS docstring gains board-commit-branch-gate.sh (4th importer).
- The hook's right-hand commit boundary (`commit([[:space:]]|$)`) is stricter than the synced Python copies' `(?![-\w])` - a semicolon-chained space-free `git commit;git push` is seen by the siblings but missed here; concrete divergence data point for the unification.
<!-- SECTION:DESCRIPTION:END -->
