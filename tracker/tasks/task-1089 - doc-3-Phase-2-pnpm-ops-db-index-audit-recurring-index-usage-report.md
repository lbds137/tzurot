---
id: TASK-1089
title: 'doc-3 Phase 2: pnpm ops db:index-audit recurring index-usage report'
status: To Do
assignee: []
created_date: '2026-09-24 21:13'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1082000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: doc-3 (Database Performance Audit) shipped Phase 1 (prevention) on 2026-07-06 and the slot moved on; the 2026-09-24 half-finished sweep found Phase 2 unnamed on any board. Converted from an epic remainder into a drain item by owner ruling 2026-09-24. The theme doc absorbs four unindexed-scan rows (incl. TASK-679) that this tool is the mechanism for surfacing.
Fix shape: an audit-class ops command reading pg_stat_user_indexes (idx_scan, size) that flags zero-scan SECONDARY indexes (PK/unique excluded) classified by the three cases in the theme doc; follow docs/reference/audit-enforcement.md before adding it. Needs a live env to run (local lane for the first prod read); the build is pure code.
Acceptance: the command runs against dev and prod and prints the classified list; doc-3 Phase 3 (per-index remediation) consumes its output.
<!-- SECTION:DESCRIPTION:END -->
