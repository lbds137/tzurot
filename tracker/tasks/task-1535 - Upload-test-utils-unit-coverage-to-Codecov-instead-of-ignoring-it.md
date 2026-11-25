---
id: TASK-1535
title: Upload test-utils unit coverage to Codecov instead of ignoring it
status: Done
assignee: []
created_date: '2026-11-25T00:22:00Z'
updated_date: '2026-11-25T16:18:00Z'
labels:
  - area:test-utils
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1532000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2806 put packages/test-utils/** in codecov.yml ignore because its coverage was never uploaded (the packages CI cell uploads only common-types lcov) and the partial component-run signal read 5.55% on a fully unit-tested file. But testLane.ts (redisDbForUrl, findWorkspaceRoot, resolveLaneRedisUrl) decides which Redis DB gets FLUSHDB, so a regression there is now invisible to the patch gate.

What: add a test:coverage script to packages/test-utils, add its lcov to the packages cell upload in .github/workflows/ci.yml, then remove the codecov.yml ignore line for packages/test-utils/**.

Acceptance: codecov reports test-utils from its own unit run; the ignore line is gone; patch gate green on a test-utils change.
<!-- SECTION:DESCRIPTION:END -->
