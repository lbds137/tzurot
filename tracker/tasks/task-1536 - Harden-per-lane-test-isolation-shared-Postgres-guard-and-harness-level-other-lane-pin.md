---
id: TASK-1536
title: >-
  Harden per-lane test isolation: shared Postgres guard and harness-level
  other-lane pin
status: Done
assignee: []
created_date: '2026-11-25T01:22:00Z'
updated_date: '2026-11-25T07:36:00Z'
labels:
  - area:test-utils
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1533000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2806 (TASK-1534) review round 5 left two minor and three nit findings. The Postgres cross-lane refusal (assertDedicatedTestDatabase) lives only in tests/e2e/cacheInvalidationTriggers.integration.test.ts, so the next real-Postgres integration test would copy or skip it; tzurot_test is exempt in every local lane; and no wiring test pins that setupTestEnvironment rejects another lane Redis DB before constructing IORedis, which is the safety property the PR exists for.

What:
1. Move the guard (_test suffix check + lane loop) into packages/test-utils/src/testLane.ts as assertLaneIntegrationDb(url); the e2e test imports it.
2. Refuse tzurot_test unless CI=true.
3. setup-pglite.test.ts: REDIS_URL=.../15 with TZUROT_TEST_LANE=b rejects with /belongs to test lane a/ and constructs no IORedis.
4. provisionLaneDatabase (packages/tooling/src/test/test-lane.ts): wrap createdb and CREATE EXTENSION failures like the reachability probe; comment or psql -v parameterize the interpolated datname literal.
5. Scope the vitest.component.config.ts / vitest.integration.config.ts comment "so parallel checkouts never share a Redis DB": two lanes can both export the same explicit non-lane DB (/5); say "never share a lane DB" or hedge.

Acceptance: items 1-4 land with tests, item 5 is a comment edit; each new assertion canary-checked red.
<!-- SECTION:DESCRIPTION:END -->
