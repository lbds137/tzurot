---
id: TASK-1300
title: >-
  Tooling gate sources under packages/tooling/src/test are excluded from unit
  coverage
status: To Do
assignee: []
created_date: '2026-10-26T21:39:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1286000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the root vitest.config.ts coverage.exclude carries '**/test/**', which drops packages/tooling/src/test/ (mutation-check.ts, mutation-gate.ts, audit-unified.ts, audit-utils.ts, audit-reporting.ts, test-tiers.ts, tier-report.ts, generate-schema.ts: the ratchet and gate implementations, not test support) from unit coverage, so Codecov never measures them although they have colocated tests. Found by PR 2667 review round 3. What: either rename that directory out of test/ (e.g. packages/tooling/src/testing/ or src/gates/) and update imports, or narrow the vitest exclude to the real test-support dirs (services/*/src/test/**, packages/conversation-history/src/test/**). Acceptance: a tooling coverage report lists the gate modules with real percentages, and codecov.yml plus every vitest coverage config agree on which test/ dirs are support.
<!-- SECTION:DESCRIPTION:END -->
