---
id: TASK-793
title: tests/ imports into service src/ are invisible to dependency-cruiser
status: To Do
assignee: []
created_date: '2026-08-28 14:57'
labels:
  - 'area:testing'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 793000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: tests/e2e/cacheInvalidationTriggers.integration.test.ts (PR 2241) imports DatabaseNotificationListener through the relative path ../../services/api-gateway/src/services/DatabaseNotificationListener.js — a reach into another workspace private src/. The dependency-cruiser config .dependency-cruiser.cjs sets includeOnly to the services/ and packages/ roots, so nothing under tests/ is cruised at all and the import is invisible to pnpm depcruise. The no-cross-service-imports rule would not have matched it regardless, since that rule is scoped from: services/. Surfaced by claude-review on PR 2241 (Low, non-blocking).

This is not a defect in that one import so much as a silent precedent: the integration tier is new and will grow, and every future test that reaches into a service internals gets the same free pass. The boundary rules exist precisely so this is a conscious decision rather than an accident.

Fix shape: decide the policy first, because both directions are defensible. Either (a) add tests/ to the dependency-cruiser includeOnly and give it an explicit rule saying what the test tier MAY reach into — expect this to surface existing imports, so budget for triage rather than assuming a clean run; or (b) expose the handful of classes the integration tier legitimately needs through the owning package surface (api-gateway has no exports map today) and forbid deep src/ paths from tests/. Option (b) is cleaner but touches package boundaries; option (a) is cheaper and makes the current state visible.

Acceptance: an import from tests/ into a service private src/ either fails pnpm depcruise, or is allowed by a rule that says so in words. Either way the next such import is a decision rather than an accident.
<!-- SECTION:DESCRIPTION:END -->
