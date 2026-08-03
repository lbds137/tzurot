---
id: TASK-419
title: Sweep stale pre-cutover route paths out of api-gateway test describe labels
status: To Do
assignee: []
created_date: '2026-08-03 23:11'
labels:
  - 'size:S'
  - 'area:api-gateway'
dependencies: []
priority: low
ordinal: 419000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: 161 describe labels in routes/**/*.test.ts still name pre-cutover paths (describe POST /wallet/set etc.) vs 4 using the real mounted /api/... forms; TASK-412 fixed source docblocks but deliberately left test labels to keep the diff reviewable. Labels mislead when a failure is triaged from CI output.
Fix shape: one scripted pass mapping each label to the mounted path from routes/_generated/mounts.ts, same source of truth as the docblock sweep; presence-then-test after the bulk edit.
Acceptance: grep for describe labels with non-/api paths returns only genuinely unmounted surfaces (public/protected routers).
<!-- SECTION:DESCRIPTION:END -->
