---
id: TASK-952
title: 'Watch: single-job restart recovery (#2253) is runtime-unverified in prod'
status: To Do
assignee: []
created_date: '2026-09-13 15:53'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 949000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: moved off backlog/now.md 🚨 (2026-09-13 context-budget trim); the fix merged 2026-08-29 as #2253 (TASK-820/821 Done) and the entry stayed only for its runtime clause.
Watch signal, next prod bot-client restart with a job in flight: the log line Single-job context rehydrated (recovery worked) and the ABSENCE of Received result for unknown job - dropping, NOT confirming. Close on that observation. Residue already filed: TASK-823, TASK-824, TASK-825.
<!-- SECTION:DESCRIPTION:END -->
