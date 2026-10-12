---
id: TASK-794
title: Integration-tier CI wiring gaps left by the doc-13 Phase 2 standup
status: To Do
assignee: []
created_date: '2026-08-28 16:05'
labels:
  - 'area:testing'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 794000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: two review findings on PR 2241 that are real incompleteness in that PR rather than pre-existing conditions, deliberately filed instead of opening an eighth review round on an otherwise-green PR.

Status 2026-10-12 (backlog review Batch A): item 1 SHIPPED (tests/tsconfig.json line 13 now has `{ "path": "../packages/cache-invalidation" }`, verified with git grep). Trimmed to item 2, still open: .github/workflows/ci.yml line ~569 "Provision integration-tier schema" is still `if: ${{ !cancelled() }}` with no step id, and the "Run integration + contract tiers" step (line ~581) is also `if: ${{ !cancelled() }}`.

(Shipped item 1, kept as the record: tests/tsconfig.json references was missing ../packages/cache-invalidation, a hole in the TS project-references graph masked by root tsconfig.json ordering.)

2. The new Provision integration-tier schema step in .github/workflows/ci.yml is gated on if: not-cancelled, and so is the Run integration + contract tiers step that follows it. A failure in the migration step therefore does not stop the test step, which then runs against a partially-migrated schema and produces a wall of relation-does-not-exist failures instead of one legible migration-failed signal. The not-cancelled pattern on the TEST step is pre-existing and deliberate (a component-test failure must not hide the contract tier result); what is new is chaining it through a step whose failure invalidates everything after it.

Fix shape: give the migration step an id and gate the test step on that step outcome being success rather than on not-cancelled alone. Confirm by deliberately breaking a migration on a scratch branch and checking CI reports the migration step red with the test step skipped, rather than a wall of schema errors.

Acceptance: a failing migration step yields a skipped test step and one clear failure.
<!-- SECTION:DESCRIPTION:END -->
