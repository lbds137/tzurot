---
id: TASK-418
title: >-
  Port or retire scripts/audit-route-auth-matrix.ts after the factory-tier
  deletion
status: To Do
assignee: []
created_date: '2026-08-03 23:11'
labels:
  - 'size:S'
  - 'area:api-gateway'
dependencies: []
priority: low
ordinal: 418000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the script builds a factory-to-prefix transitive-mount graph, but TASK-412 deleted 27 of the factories it walks; the analysis premise is largely gone. The live route table is routes/_generated/mounts.ts.
Fix shape: either port the auth-matrix walker to read mounts.ts directly (which is simpler: mounts are flat app.<method> calls with inline middleware) or delete the script if the conformance/mounts tests already cover the auth-matrix question.
Acceptance: no analysis tool walks the deleted factory tier.
<!-- SECTION:DESCRIPTION:END -->
