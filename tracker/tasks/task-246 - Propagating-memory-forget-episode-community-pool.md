---
id: TASK-246
title: Propagating /memory forget (episode + community-pool)
status: To Do
assignee: []
created_date: 2026-07-09 00:00
updated_date: '2026-11-27T04:45:00Z'
labels:
  - area:ai-worker
  - area:bot-client
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 246000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Propagating `/memory forget` (episode + community-pool) — The correction slice shipped `/memory forget` as **per-fact terminal** (owner decision). The architecture doc §3.6a defines the fuller semantics: forgetting a fact ALSO soft-deletes the source episode(s) it derived from and removes its community-pool contributions. **Fix shape**: extend the forget handler to walk `sourceMemoryIds` and (with confirmation) soft-delete those episodes + strip pool contributions. **Promote when**: Phase-3 community-pool machinery lands (pool contributions don't exist yet). Surfaced 2026-07-09 (correction slice, owner-scoped to per-fact for now).

**Why:** The doc's full forget semantics; deferred to when pools exist.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: backlog-pilot
created: 2026-11-26 23:44
---
NOTE (backlog pilot, 50-oldest sweep): the promote-when ("Phase-3 community-pool machinery lands") has FIRED — `Memory.pool 'private'|'community'|'canon'` (prisma/schema.prisma:962-967, Phase-3 comment) and `MemoryFact.pool` (:1078-1080) are live on develop; the gateway forget handler is still explicitly per-fact (`memoryFacts.ts:358` doc comment "the source episode is untouched"). STATE FLIPPED state:dependent → state:ready on that verified basis (mechanical reachability correction, not a priority change). Remaining work is unchanged: walk `sourceMemoryIds`, soft-delete source episodes with confirmation, strip pool contributions.
---
<!-- COMMENTS:END -->
