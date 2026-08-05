---
id: TASK-106
title: Normalize non-standard IP formats in publicRouteKeyGenerator
status: To Do
assignee: []
created_date: '2026-05-17 00:00'
updated_date: '2026-07-28 10:48'
labels:
  - 'area:api-gateway'
  - 'area:redis'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 106000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Normalize non-standard IP formats in `publicRouteKeyGenerator`

**Why:** Two edge cases land the same client in different Redis buckets: bracket+port IPv6 (`[2001:db8::1]:8080`, RFC 7239 §6.3) and IPv4-mapped IPv6 (`::ffff:127.0.0.1` from Node's `socket.remoteAddress`). Won't surface in current Railway deployment. **Promote when**: Railway logs show non-standard XFF formats, or when adopting non-Railway hosting. **Start**: `services/api-gateway/src/utils/RedisRateLimiter.ts` `publicRouteKeyGenerator`. Surfaced 2026-05-17 by PR #1046 review. Deferred 2026-05-19.
<!-- SECTION:DESCRIPTION:END -->
