---
id: TASK-1211
title: 'branch_switch.py: a table test pinning its three-line output contract'
status: Done
assignee: []
created_date: '2026-10-11 16:41'
updated_date: '2026-10-11 21:25'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1200000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: .claude/hooks/lib/branch_switch.py (TASK-1203, PR 2603) is ~520 lines of shell-text parsing whose __main__ prints three positional lines (switch target, commit dir, others-inert bit) that develop-code-commit-guard.sh reads with three `read -r` and board-commit-branch-gate.sh reads with one. It is covered only through the hook probes, which assert final exit codes, not which helper rule decided, so two overlapping rules can mask a regression in one of them. claude-review raised this on three consecutive rounds of PR 2603.

What: a colocated python unittest table (input command -> (switch_target, commit_dir, inert)) covering one case per rule in the module docstring, plus the empty-line contract on failure; wire it into an existing CI step (guard:hook-probes or a probe file) so it runs in CI.

Acceptance: the table runs in CI; removing any single rule from the helper reddens at least one table row.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-11 shipped in #2607: branch_switch_test.py (112 rows, 22 bad-ref names, __main__ contract) run by board-commit-branch-gate.probe.sh; canaries 3/7/1 rows. Known gap pinned as observed: TASK-1214.
<!-- SECTION:NOTES:END -->
