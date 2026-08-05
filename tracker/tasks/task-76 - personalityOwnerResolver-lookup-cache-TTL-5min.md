---
id: TASK-76
title: personalityOwnerResolver lookup cache (TTL ~5min)
status: To Do
assignee: []
created_date: '2026-04-25 00:00'
updated_date: '2026-07-28 10:47'
labels:
  - 'area:ai-worker'
  - 'area:db'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 76000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`personalityOwnerResolver` lookup cache (TTL ~5min)

**Why:** `services/ai-worker/src/services/diagnostics/personalityOwnerResolver.ts:resolvePersonalityOwnerDiscordId` fires a `prisma.user.findUnique` on every AI generation request to surface owner Discord ID for diagnostic-meta. Lookup is ~1ms typical (single indexed query) and not on a profiled hot path; cache adds invalidation complexity. Options when promoted: (a) thin in-memory `TTLCache<string, string|null>` keyed by `personalityOwnerInternalId`; (b) extend `UserService` with a cached `getDiscordIdByInternalUuid` (more reusable if a second consumer surfaces). **Promote when**: generation latency tightening identifies this resolver as a material p95 contributor — profile production diagnostic logs first, optimize second. Surfaced 2026-04-25 by claude-bot on PR #898. Deferred 2026-04-27.
<!-- SECTION:DESCRIPTION:END -->
