---
id: TASK-1394
title: Split the component tier into parallel PGLite-only and serial Redis projects
status: To Do
assignee: []
created_date: '2026-11-10T14:24:00Z'
labels:
  - area:tests
  - size:M
  - state:ready
dependencies: []
priority: low
ordinal: 1377000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: vitest.component.config.ts:52-58 sets fileParallelism false because packages/test-utils/src/setup-pglite.ts:147 flushes a shared Redis; step median 177 s, yet only ~17 of 61 files touch Redis (Fable grep, unverified).
What: two vitest projects; Redis-touching files serial.
Saving (estimate): 60-100 s, visible in wall time only once lint drops below the component job (Fable perf review 2026-11-10, item P10).
Risk: a misclassified file becomes a data-wiping flake.
<!-- SECTION:DESCRIPTION:END -->
