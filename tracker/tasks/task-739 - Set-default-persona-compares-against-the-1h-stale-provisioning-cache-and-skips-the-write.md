---
id: TASK-739
title: >-
  Set-default-persona compares against the 1h-stale provisioning cache and skips
  the write
status: To Do
assignee: []
created_date: '2026-08-23 03:23'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 739000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: prod repro by the owner (2026-08-23 03:17-03:18 UTC, gateway log "Set default persona" x4): set Lena -> alreadyDefault=false (wrote), set Lila back -> alreadyDefault=true (SKIPPED, twice). Mechanism (traced + runtime-confirmed): handleSetPersonaDefault (services/api-gateway/src/routes/user/persona/default.ts:43) compares the target id against req.provisionedDefaultPersonaId, which AuthMiddleware stamps from UserService.getOrCreateUser — a 1h-TTL in-memory cache (packages/identity/src/UserService.ts, USER_CACHE_TTL_MS) that NOTHING invalidates on a default change (only account deletion evicts; the cache doc calls staleness "bounded and cosmetic", but here the stale read GATES a write). Net: the DB default silently stays on the first-set value while the UI reports the old one, and the user cannot correct it via the command until TTL expiry or a gateway restart.

Fix shape: after the prisma.user.update in the route, invalidate the provisioning cache for this discordId (getOrCreateUserService(prisma).invalidateUser + the Redis UserCacheInvalidationService broadcast, mirroring AccountEraserService) — the broadcast half matters because ai-worker shares the same UserService cache per its doc comment, so a default change may also be invisible to generation for up to 1h (verify ai-worker's read path at build; if real, that is a second symptom of the same missing invalidation). Sweep for siblings: any other route that writes a field the provisioning cache carries.

Acceptance: set A -> set B -> set A round-trips with correct messages and correct DB state, pinned by a test that goes through the cached middleware path; the cache-invalidation call is asserted at the seam.
<!-- SECTION:DESCRIPTION:END -->
