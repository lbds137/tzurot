---
id: TASK-1511
title: 'Dispatch specs: list every vi.mock factory of a module whose exports change'
status: Done
assignee: []
created_date: '2026-11-22T23:51:00Z'
updated_date: '2026-11-25T18:08:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1511000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: in PR #2788 (TASK-1356) two consecutive review-round dispatches added an export (a function, then a constant) to packages/tooling/src/deployment/railway-deployment-status.ts, and both workers hit packages/tooling/src/secrets/rotation.test.ts, whose vi.mock factory for that module enumerates its exports explicitly (02-code-standards: explicit enumeration). The new export was undefined under the mock (round 1: 32 red tests; round 2: 30 timeouts, a silently swallowed TypeError inside a poll loop). Each worker correctly stopped, costing a round trip each time.

What: add to the /tzurot-orchestration spec template (Premise ledger guidance) a mandatory row for any unit that adds or renames an export: the output of `git grep -n "vi.mock(.*<module basename>"` across the repo, with each factory named in the spec as a sanctioned fixture edit.

Acceptance: the spec template carries the row with a runnable grep; a probe or example shows it finding rotation.test.ts for railway-deployment-status.
<!-- SECTION:DESCRIPTION:END -->
