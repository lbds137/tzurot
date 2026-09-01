---
id: TASK-677
title: 'Temporal-marker hook misses bare "PR 2" (no hash, no hyphen)'
status: Done
assignee: []
created_date: '2026-08-19 04:20'
updated_date: '2026-09-01 23:43'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 677000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: two temporal markers reached review in PR #2148 ("the PR 3 backfill", "PR 2's caller") and the pre-commit hook passed them. TEMPORAL_PATTERN in .husky/pre-commit line 128 matches `PR #[0-9]+` and `PR-[0-9]+` — both require a `#` or a hyphen, so the bare space form `PR 2` is unmatched. The rule it enforces (02-code-standards § Temporal Markers) forbids PR refs in code comments regardless of punctuation, so this is a gap in the instrument, not in the rule.

The multi-PR-slice workflow makes the bare form the LIKELY one: prose naturally says "lands in PR 3", never "lands in PR #3", because the number is a position in a rollout plan rather than a link to a GitHub PR. That is also exactly the shape the rule most wants to catch — a rollout position goes stale the moment the plan changes (TASK-660 shipped as "3-4 PRs", so "PR 3" may not be the backfill at all).

Fix shape: add `PR [0-9]+` to the TEMPORAL_PATTERN alternation. False-positive risk is low — a code comment saying "PR" followed by a number is archaeology essentially every time. Line 115 of the hook already mandates a smoke test after editing TEMPORAL_PATTERN; run it, and run the husky-pre-commit probe.

Not folded into PR #2148 because .husky/ is review-gated and affects every contributor's commits; bolting it onto a schema migration PR puts a hook change in front of a reviewer who came for a column.

Acceptance: a staged code comment containing bare "PR 3" is rejected by pre-commit; the existing probe still passes; the smoke test at line 115 is run.
<!-- SECTION:DESCRIPTION:END -->
