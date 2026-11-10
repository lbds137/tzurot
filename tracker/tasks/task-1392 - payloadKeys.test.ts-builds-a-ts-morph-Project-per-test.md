---
id: TASK-1392
title: payloadKeys.test.ts builds a ts-morph Project per test
status: To Do
assignee: []
created_date: '2026-11-10T14:24:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1375000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: packages/tooling/src/surface/payloadKeys.test.ts:14-18 creates a new Project per test; 7.0 s unloaded, 28.4 s loaded.
What: one module-level Project with a uniquely named source file per test.
Saving (estimate): ~5 s unloaded per tooling run (Fable perf review 2026-11-10, item P8).
<!-- SECTION:DESCRIPTION:END -->
