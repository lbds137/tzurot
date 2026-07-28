---
id: TASK-346
title: Audit remaining route-factory functions for dead production wiring
status: To Do
assignee: []
created_date: '2026-07-28 22:27'
updated_date: '2026-07-28 22:27'
labels:
  - 'area:api-gateway'
  - 'size:M'
dependencies: []
priority: medium
ordinal: 346000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the codegen mounts.ts cutover left legacy router factories behind in several route families. Two confirmed-dead ones are already deleted (#1836 createAIRouter, TASK-316 createMemoryRoutes/createFreshRoutes/createIncognitoRoutes — the latter's "preserved for existing wiring" comments were stale lies). ~17 test files still consume expressRouterUtils to extract handlers from factory-built routers (admin/denylist, admin/settings, admin/tts-config, admin/usage, admin/diagnostic, admin/llm-config, wallet/setKey, wallet/testKey, wallet/listKeys, user/timezone, user/config-overrides, user/personality-config-overrides, user/model-override, user/llm-config, user/usage, user/history, shared-route-test-utils), suggesting their factories may also be dead in production (index.ts records the /internal /wallet aggregator mounts as removed).

Fix shape: per family — grep the factory's production consumers; if only tests consume it, delete the factory and migrate the tests to direct handler construction (the TASK-316 memory-family PR is the pattern: route wiring is owned by mounts.ts + codegen:routes --check; tests exercise handlers directly). If a factory IS production-mounted, leave it and record why. expressRouterUtils itself becomes deletable once its last factory-based suite migrates.

Acceptance: every remaining create*Routes/create*Router factory either has a verified production mount or is deleted with its tests migrated.
<!-- SECTION:DESCRIPTION:END -->
