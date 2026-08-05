---
id: TASK-8
title: api-gateway missing UserCacheInvalidationService subscription
status: To Do
assignee: []
created_date: '2026-07-16 00:00'
updated_date: '2026-07-28 10:46'
labels:
  - 'area:api-gateway'
  - 'area:ai-worker'
  - 'origin:review'
  - 'size:M'
  - 'state:dependent'
dependencies: []
priority: medium
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-16 (#1661 review) — api-gateway does not subscribe to `UserCacheInvalidationService` broadcasts — only ai-worker does. Today that's correct: deletion always runs in api-gateway, which evicts its OWN process synchronously in the delete route, and the broadcast's only intended audience is ai-worker. But a second api-gateway replica would never hear about a deletion performed on the first (no synchronous call, no subscription) — reopening the post-deletion FK-violation class across api-gateway replicas specifically. The topology is documented in `UserCacheInvalidationService.ts` / `UserService.invalidateUser`'s comments. **Fix shape**: wire an api-gateway-side subscriber (same `clearCache`/`invalidateUser` wiring ai-worker's `wireUserCacheInvalidation` uses), skipping self-eviction double-work if desired. **Promote when**: api-gateway is ever scaled past one replica.

**Why:** Single-replica assumption baked into the eviction topology; harmless until the replica count changes.
<!-- SECTION:DESCRIPTION:END -->
