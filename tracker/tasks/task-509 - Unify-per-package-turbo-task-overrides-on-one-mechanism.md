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
<!-- SECTION:DESCRIPTION:END -->
