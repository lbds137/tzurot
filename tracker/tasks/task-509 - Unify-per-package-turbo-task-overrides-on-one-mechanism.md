---
id: TASK-509
title: Unify per-package turbo task overrides on one mechanism
status: To Do
assignee: []
created_date: '2026-08-10 20:30'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 509000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: two mechanisms now exist for widening a package task cache inputs - the root turbo.json @tzurot/common-types#test override, and the packages/tooling/turbo.json Package Configuration (PR 2054). A contributor auditing what a task hashes must know to check both places. Flagged by review round 2 of PR 2054.
Fix shape: pick the per-package turbo.json style (keeps the root file lean, scales to long glob lists), migrate the common-types#test root override into packages/common-types/turbo.json, and note the convention in 05-tooling.md or the tooling README. Verify with turbo --dry=json that the resolved definition is unchanged after the migration.
Acceptance: exactly one override mechanism in use repo-wide; convention documented.

Probe result (PR 2054 round 6, finding 4): with the explicit packages/common-types/src glob REMOVED from packages/tooling/turbo.json, editing a tracked common-types src file still changed tooling#test's hash (d2672437991ee9a2 -> e46bd04bae98adba via turbo --dry=json) - turbo's package-graph hashing (workspace dep + dependsOn ^build) already busts the cache on internal-dep edits. Explicit same-repo-package globs in inputs are therefore redundant for cache-busting; PR 2054 keeps the glob anyway because the turbo-inputs-coverage guard requires every swept root explicitly. Relevant when migrating common-types#test: its ../../packages/*/src/** glob half may be droppable for the same reason (re-probe there).
<!-- SECTION:DESCRIPTION:END -->
