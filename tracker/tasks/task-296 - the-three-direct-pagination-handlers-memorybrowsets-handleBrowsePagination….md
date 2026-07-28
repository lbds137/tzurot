---
id: TASK-296
title: Align the three direct pagination handlers (memory browse et al)
status: To Do
assignee: []
created_date: '2026-07-18 00:00'
updated_date: '2026-07-28 10:52'
labels:
  - 'origin:review'
  - 'area:bot-client'
  - 'size:M'
dependencies: []
priority: low
ordinal: 296000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-18 (#1710 r1, the stale-page race) — the three direct pagination handlers (`memory/browse.ts` `handleBrowsePagination`, `factsBrowse.ts` `handleFactsPagination`, `search.ts` `handleSearchPagination`) fetch the requested offset raw; only the refresh-after-delete paths route through `fetchPageWithEmptyFallback`'s step-back. The builder now degrades a stale empty page to the empty state (shipped same PR), but the SOURCE fix is routing those three through the same fallback so a stale click lands on the last real page instead of an empty-state screen. **Promote when**: next memory-browse handler touch, or a user report of the empty-state-on-stale-click annoyance.

**Why:** The builder fix makes the race benign; the fallback routing would make it invisible.
<!-- SECTION:DESCRIPTION:END -->
