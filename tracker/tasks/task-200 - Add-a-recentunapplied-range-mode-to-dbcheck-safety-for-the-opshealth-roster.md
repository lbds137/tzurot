---
id: TASK-200
title: 'Add a recent/unapplied-range mode to db:check-safety for the ops:health roster'
status: To Do
assignee: []
created_date: '2026-07-03 00:00'
updated_date: '2026-07-28 10:50'
labels:
  - 'area:tooling'
  - 'area:db'
  - 'size:S'
dependencies: []
priority: low
ordinal: 200000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Add a recent/unapplied-range mode to `db:check-safety` for the ops:health roster

**Why:** A bare run scans ALL historical migrations and re-flags applied, reviewed ones forever (26 findings, e.g. Feb 2026 drops) — perma-red in aggregate mode. **Fix shape**: a `--range`/`--recent` mode scoped to migrations newer than the last applied (or last N), keeping the full-history scan for explicit invocations. Then add it back to `HEALTH_TOOLS`. **Promote when**: next touching check-safety, or when the weekly report needs more coverage. Surfaced 2026-07-03 (ops:health maiden run).
<!-- SECTION:DESCRIPTION:END -->
