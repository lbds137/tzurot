---
id: TASK-106
title: Normalize non-standard IP formats in publicRouteKeyGenerator
status: To Do
assignee: []
created_date: '2026-05-17 00:00'
updated_date: '2026-09-04 20:01'
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

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 20:01
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-92 (Idea Scale gated watches — threshold inventory for the single instance ceiling); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-106 finds it.
---
<!-- COMMENTS:END -->
