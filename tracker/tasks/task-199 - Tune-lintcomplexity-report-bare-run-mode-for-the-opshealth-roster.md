---
id: TASK-199
title: 'Tune lint:complexity-report bare-run mode for the ops:health roster'
status: To Do
assignee: []
created_date: '2026-07-03 00:00'
updated_date: '2026-07-28 10:50'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 199000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Tune `lint:complexity-report` bare-run mode for the ops:health roster

**Why:** A repo-wide run includes the deliberately-broken audit-canary fixture (complexity 25), so `--summary` structurally reports fail every time — 1507 findings on the maiden ops:health run. **Fix shape**: exclude `test-fixtures/audit-canaries/` from the default scan (the canary test passes targetDirs explicitly, so canary coverage is unaffected) and consider a baseline so status reflects regressions, not absolute counts. Then add it back to `HEALTH_TOOLS` in `audits/health.ts`. **Promote when**: next touching complexity-report, or when the weekly report needs more coverage. Surfaced 2026-07-03 (ops:health maiden run).
<!-- SECTION:DESCRIPTION:END -->
