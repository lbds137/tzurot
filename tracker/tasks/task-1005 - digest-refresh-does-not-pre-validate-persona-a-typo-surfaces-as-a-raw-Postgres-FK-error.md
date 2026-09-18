---
id: TASK-1005
title: >-
  digest:refresh does not pre-validate --persona; a typo surfaces as a raw
  Postgres FK error
status: To Do
assignee: []
created_date: '2026-09-18 00:48'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1001000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: packages/tooling/src/digest/refresh.ts resolves --personality by slug and raises a clean UsageError when it is unknown, but --persona is passed straight into the INSERT, so a mistyped UUID fails with a raw foreign-key or cast error from Postgres instead of a readable message. Operator-only CLI, low severity (PR #2445 round-5 review nit, deferred at merge to avoid another CI cycle).
Fix shape: add a resolvePersonaId(prisma, id) that SELECTs personas by id and throws UsageError("No persona found with id ...") before readRow; one unit test in refresh.test.ts asserting the UsageError on an unknown id.
<!-- SECTION:DESCRIPTION:END -->
