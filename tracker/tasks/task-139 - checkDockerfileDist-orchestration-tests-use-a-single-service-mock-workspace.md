---
id: TASK-139
title: checkDockerfileDist orchestration tests use a single-service mock workspace
status: To Do
assignee: []
created_date: '2026-06-03 00:00'
updated_date: '2026-07-28 10:49'
labels:
  - 'area:tooling'
  - 'area:testing'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 139000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`checkDockerfileDist` orchestration tests use a single-service mock workspace

**Why:** `checkService` unit coverage is thorough; the untested property is multi-service aggregation (findings from several services combined, exit code set on any). **Promote when**: a coverage audit flags the orchestration path, or the guard gains per-service behavior that diverges by service count. Surfaced by PR #1148 claude-review. Deferred 2026-06-03.
<!-- SECTION:DESCRIPTION:END -->
