---
id: TASK-743
title: >-
  Gateway PersonaResolver instances never hear persona invalidation - no
  subscription exists
status: To Do
assignee: []
created_date: '2026-08-23 09:42'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 743000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: found during the TASK-740 hygiene batch (#2192). services/api-gateway/src/routes/internal/routingContextCreate.ts:44 and services/api-gateway/src/utils/historyContextResolver.ts:79 each construct a private new PersonaResolver(prisma). Unlike the ai-worker case fixed in #2192, the gateway NEVER subscribes to the persona invalidation channel at all, so swapping in getOrCreatePersonaResolver alone would not fix staleness - the process needs a subscription too. Staleness bound today: the bare-construction 10s TTL (INTERVALS.API_KEY_CACHE_TTL via BaseConfigResolver, verified in the TASK-740 analysis), so low severity until anyone raises that TTL - the same dormant shape TASK-740 fixed.

Fix shape: add a persona-channel subscription to the gateway bootstrap (mirror ai-worker cacheInvalidation.ts), convert both sites to getOrCreatePersonaResolver, and evict that shared instance from the subscription handler.

Acceptance: both gateway sites resolve through the shared accessor; a persona invalidation event evicts the gateway resolver cache, asserted at the seam; no bare new PersonaResolver( remains in api-gateway src.
<!-- SECTION:DESCRIPTION:END -->
