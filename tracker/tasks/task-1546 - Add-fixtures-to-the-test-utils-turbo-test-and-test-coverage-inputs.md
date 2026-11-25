---
id: TASK-1546
title: Add fixtures/** to the test-utils turbo test and test:coverage inputs
status: To Do
assignee: []
created_date: '2026-11-25T16:13:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1543000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: packages/test-utils/src/contractFixtures.ts reads packages/test-utils/fixtures/contracts/** with readFileSync at test time, but turbo.json gives the test and test:coverage tasks inputs ["src/**", "*.config.ts", "vitest.config.ts"]. A change that touches only a fixture JSON replays a cached local test and test:coverage result, with a stale lcov. CI runners start cold, so only local and pre-push runs are affected. Found by the PR 2811 review (finding 2).

What: package-scoped turbo overrides "@tzurot/test-utils#test" and "@tzurot/test-utils#test:coverage" whose inputs add fixtures/** (and schema/** if a test reads it; check by grep).

Acceptance: editing only a fixture JSON makes turbo re-run test-utils tests instead of reporting a cache hit.
<!-- SECTION:DESCRIPTION:END -->
