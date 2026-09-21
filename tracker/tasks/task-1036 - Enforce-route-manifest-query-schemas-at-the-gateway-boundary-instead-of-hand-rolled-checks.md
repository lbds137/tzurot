---
id: TASK-1036
title: >-
  Enforce route-manifest query schemas at the gateway boundary instead of
  hand-rolled checks
status: To Do
assignee: []
created_date: '2026-09-21 19:13'
labels:
  - 'area:api-gateway'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1030000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the route manifest (packages/clients/src/routes/**) declares a Zod query schema per route, but the gateway handlers do not run it - they cast req.query and hand-roll the equivalent checks (services/api-gateway/src/routes/user/memoryFacts.ts handleListFacts validates personalityId and tag by hand while packages/clients/src/routes/user/facts.ts declares tag as z.string().trim().max(100).optional()). The manifest schema today backs only client-side type generation and its own unit test, so the two validations stay in sync by hand and can drift silently (surfaced by claude-review on PR #2467 as a pre-existing pattern; the only schema-parsed query today is the config-route helper, services/api-gateway/src/utils/configRouteHelpers.ts:69 and :93).
Fix shape: a middleware or route-mount helper that resolves the manifest entry for the mounted route and safeParses req.query (and req.params where declared) against it, replacing the per-handler casts; on failure use the existing sendZodError shape. Roll out route by route or by audience, with the facts list route as the first conversion since its tests already pin both edges (100 accepted, 101 rejected, whitespace absent, array-shaped absent) and would pin the middleware the same way. Note the array-shaped query decision recorded on PR #2467: with the manifest enforced, a repeated ?tag= becomes a 400 via the schema instead of being treated as absent - decide and document that change when converting the route.
Acceptance: the facts list route validates its query through the manifest schema with no hand-rolled check left in the handler, the existing boundary tests still pass, and a drift guard (a test that every user route with a declared query schema is mounted through the helper) fails when a new route bypasses it.
<!-- SECTION:DESCRIPTION:END -->
