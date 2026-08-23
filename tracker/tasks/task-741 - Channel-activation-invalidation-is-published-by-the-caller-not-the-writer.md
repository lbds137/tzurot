---
id: TASK-741
title: Channel-activation invalidation is published by the caller not the writer
status: Done
assignee: []
created_date: '2026-08-23 03:44'
updated_date: '2026-08-23 13:36'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 741000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: class sweep after TASK-739. The channel-activation pub/sub invalidation is published from bot-client command handlers (services/bot-client/src/commands/channel/activate.ts:33-37, deactivate.ts) AFTER calling the gateway API - the gateway route that actually writes the row publishes nothing (grep ChannelActivationCacheInvalidation in services/api-gateway/src/routes: zero hits). Works today because those two commands are the only writers, but any future writer (admin route, sync service, ops script) silently skips invalidation - the same one-missed-writer shape as TASK-739. Staleness bound if missed: the 30s activation TTL.

Fix shape: move the publish into the gateway write route (writer-owns-invalidation, matching every other invalidation service), leaving bot-client only its local TTLCache bust.

Acceptance: the gateway activation write route publishes; bot-client no longer constructs ChannelActivationCacheInvalidationService for the write path; existing activate/deactivate behavior pinned by the route test asserting the publish seam.
<!-- SECTION:DESCRIPTION:END -->
