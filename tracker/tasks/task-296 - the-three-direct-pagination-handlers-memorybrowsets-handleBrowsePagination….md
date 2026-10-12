---
id: TASK-296
title: Align the three direct pagination handlers (memory browse et al)
status: To Do
assignee: []
created_date: '2026-07-18 00:00'
updated_date: '2026-09-04 19:36'
labels:
  - 'origin:review'
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 296000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-18 (#1710 r1, the stale-page race) — the three direct pagination handlers (`memory/browse.ts` `handleBrowsePagination`, `factsBrowse.ts` `handleFactsPagination`, `search.ts` `handleSearchPagination`) fetch the requested offset raw; only the refresh-after-delete paths route through `fetchPageWithEmptyFallback`'s step-back. The builder now degrades a stale empty page to the empty state (shipped same PR), but the SOURCE fix is routing those three through the same fallback so a stale click lands on the last real page instead of an empty-state screen. **Promote when**: next memory-browse handler touch, or a user report of the empty-state-on-stale-click annoyance.

**Why:** The builder fix makes the race benign; the fallback routing would make it invisible.

## Merged from TASK-247 (2026-10-12)

TASK-247 (priority low, same cluster, "work with TASK-296") covered the same browse/detail router pattern across episodes AND facts, which share the shapes byte-for-byte (facts copied them forward from memory/browse.ts deliberately). Part (a), the stale-pagination render, is this task. Part (b) is the addition: **silent no-op on expired session** in `refreshBrowseList` / `refreshSearchList` / `refreshFactsList` (the back / confirm-delete / confirm-forget paths) - no "expired" followUp, unlike the pagination handlers. Fix shape for (b): add the expired followUp to the refresh helpers. Also from 247: remove (or comment) the dead `xHelpers.isBrowseSelect` OR-branches in `handleSelectMenu` - both episode and fact select menus route via the detail `::select` id, so the browse-select checks never match (PR #1568 round-2 observation; digest pass 2026-09-04 confirmed `isBrowseSelect` is still wired the same way). For (a) the fix is re-fetch at `safePage` when it differs from the requested page. Fix all copies together (reuse-scout consolidation rule). Surfaced 2026-07-09 (PR #1568 review). Promote when: next touch of the browse/detail router pattern, or a user reports the phantom-empty-page.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:36
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. Confirmed: `handleBrowsePagination` (browse.ts), and by the same pattern `handleFactsPagination`/`handleSearchPagination`, fetch the requested page raw; `fetchPageWithEmptyFallback` is imported and used ONLY inside the refresh-after-delete/back helpers (`refreshBrowseList` at line 386), not the direct pagination handlers themselves. Source fix (routing all three through the fallback) still not done. See cluster note with TASK-247 above. Evidence: `sed -n '282,400p' memory/browse.ts` — `fetchPageWithEmptyFallback` call is inside `refreshBrowseList`, well after `handleBrowsePagination`'s own raw-fetch block.
---
<!-- COMMENTS:END -->
