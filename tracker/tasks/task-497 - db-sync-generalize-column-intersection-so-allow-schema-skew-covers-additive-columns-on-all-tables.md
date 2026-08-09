---
id: TASK-497
title: >-
  db-sync: generalize column intersection so allow-schema-skew covers additive
  columns on all tables
status: To Do
assignee: []
created_date: '2026-08-09 19:47'
labels:
  - 'area:db'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 497000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner question 2026-08-09 during the tags rollout. The sync fails closed on migration-version mismatch (good), but the allow-schema-skew escape hatch is only safe for the two vector tables - resolveVectorSyncColumns (SyncUpsertBuilder.ts ~148-194) intersects the column list with what BOTH databases have. Every other table fetches SELECT * and builds upsert columns from the SOURCE row keys (~227, ~326), so during a dev-ahead additive window (e.g. personalities.tags) a dev->prod upsert errors 42703 on the missing target column.
Fix shape: generalize the both-sides intersection to all sync tables - introspect information_schema.columns on both clients once per run, intersect per table, log skipped columns with the existing soak-window warning. The vector tables keep their explicit canonical lists (the ::text cast contract) intersected as today.
Acceptance: a unit/PGLite test simulating a target missing one column shows the row syncs with that column skipped + warned, both directions; allow-schema-skew becomes genuinely safe for additive migrations.
<!-- SECTION:DESCRIPTION:END -->
