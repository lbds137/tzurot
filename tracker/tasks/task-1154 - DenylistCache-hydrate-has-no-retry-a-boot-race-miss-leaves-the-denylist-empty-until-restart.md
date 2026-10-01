---
id: TASK-1154
title: >-
  DenylistCache hydrate has no retry - a boot-race miss leaves the denylist
  empty until restart
status: To Do
assignee: []
created_date: '2026-10-01 21:45'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1146000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the boot-b relaunch 2026-10-01 caught it live — bot-client and api-gateway co-launched, the startup hydrate hit :3000 before the gateway listened, and the cache stayed EMPTY for the whole boot session (zero Hydrated-from-gateway lines afterward). Fail-open means permissive: the denylist gates abuse, so a silently empty list is a real degradation window, not noise. The hydrate comment claims the cache is "populated once the gateway becomes reachable (via retry or pub/sub sync)" — pub/sub invalidation exists (`DenylistCacheInvalidationService`) but there is no retry and no health-recovery re-hydrate, so the comment overclaims.

What: add a bounded retry/backoff to `DenylistCache.hydrate` (or re-hydrate on gateway-health recovery), and fix the comment to name only the mechanisms that exist. Pin with a test asserting a failed first hydrate recovers without a restart.

Acceptance: a boot where the gateway is slow to listen does not leave the denylist empty until an unrelated invalidation event happens to fire.
<!-- SECTION:DESCRIPTION:END -->

