---
id: TASK-246
title: Propagating /memory forget (episode + community-pool)
status: To Do
assignee: []
created_date: '2026-07-09 00:00'
updated_date: '2026-07-28 10:51'
labels:
  - 'area:ai-worker'
  - 'area:bot-client'
  - 'size:M'
dependencies: []
priority: medium
ordinal: 246000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Propagating `/memory forget` (episode + community-pool) — The correction slice shipped `/memory forget` as **per-fact terminal** (owner decision). The architecture doc §3.6a defines the fuller semantics: forgetting a fact ALSO soft-deletes the source episode(s) it derived from and removes its community-pool contributions. **Fix shape**: extend the forget handler to walk `sourceMemoryIds` and (with confirmation) soft-delete those episodes + strip pool contributions. **Promote when**: Phase-3 community-pool machinery lands (pool contributions don't exist yet). Surfaced 2026-07-09 (correction slice, owner-scoped to per-fact for now).

**Why:** The doc's full forget semantics; deferred to when pools exist.
<!-- SECTION:DESCRIPTION:END -->
