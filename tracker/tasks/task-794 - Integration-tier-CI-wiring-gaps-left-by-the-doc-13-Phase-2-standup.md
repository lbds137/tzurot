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

1. tests/tsconfig.json references is missing ../packages/cache-invalidation. PR 2241 added @tzurot/cache-invalidation to tests/package.json dependencies (the integration test imports its type) but did not add the matching project reference. packages/cache-invalidation/tsconfig.json is composite:true, so this is a real hole in the TS project-references graph and matters for build ordering under a scoped tsc -b tests. The root tsconfig.json currently MASKS it by listing cache-invalidation earlier than tests in its own flat reference list, which is why nothing fails today.

2. The new Provision integration-tier schema step in .github/workflows/ci.yml is gated on if: not-cancelled, and so is the Run integration + contract tiers step that follows it. A failure in the migration step therefore does not stop the test step, which then runs against a partially-migrated schema and produces a wall of relation-does-not-exist failures instead of one legible migration-failed signal. The not-cancelled pattern on the TEST step is pre-existing and deliberate (a component-test failure must not hide the contract tier result); what is new is chaining it through a step whose failure invalidates everything after it.

Fix shape: add the missing reference; give the migration step an id and gate the test step on that step outcome being success rather than on not-cancelled alone. Confirm by deliberately breaking a migration on a scratch branch and checking CI reports the migration step red with the test step skipped, rather than a wall of schema errors.

Acceptance: tsc -b tests resolves cache-invalidation through the references graph rather than through root ordering; a failing migration step yields a skipped test step and one clear failure.
<!-- SECTION:DESCRIPTION:END -->
