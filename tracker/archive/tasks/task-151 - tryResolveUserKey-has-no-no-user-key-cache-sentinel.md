---
id: TASK-151
title: tryResolveUserKey has no "no-user-key" cache sentinel
status: To Do
assignee: []
created_date: '2026-06-17 00:00'
updated_date: '2026-09-04 19:41'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 151000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`tryResolveUserKey` has no "no-user-key" cache sentinel

**Why:** `ApiKeyResolver.tryResolveUserKey` (ai-worker) caches a hit but NOT a miss, so a user lacking a key for the vision provider re-reads the DB on every cross-provider vision request (cold-cache path). PR #1240 routes more RAG vision traffic through per-provider resolution, hitting this more. The code comment already flags it. **Fix shape**: a distinct "no-user-key" cache state (without muddying the system-source cache semantics `resolveApiKey` depends on). **Promote when**: per-request DB reads for missing vision keys become a measured hotspot. Surfaced 2026-06-17 by PR #1240 (Bug Y). Deferred 2026-06-17.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:41
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: ARCHIVED. superseded: duplicate of TASK-82 (same tryResolveUserKey miss-caching gap, vision-routing angle); TASK-82 carries the PR #925 invariant test and moves to doc-18.
---
<!-- COMMENTS:END -->
