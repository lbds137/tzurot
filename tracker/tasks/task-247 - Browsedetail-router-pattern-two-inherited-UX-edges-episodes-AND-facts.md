---
id: TASK-247
title: 'Browse/detail router pattern: two inherited UX edges (episodes AND facts)'
status: To Do
assignee: []
created_date: '2026-07-09 00:00'
updated_date: '2026-07-28 10:51'
labels:
  - 'origin:review'
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 247000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Browse/detail router pattern: two inherited UX edges (episodes AND facts) — Both surfaces share the shapes byte-for-byte (facts copied them forward from `browse.ts` deliberately): (a) **stale-pagination render** — pagination fetches the REQUESTED page, then computes `safePage` from the fresh total but renders the already-fetched (possibly empty) items instead of re-fetching at `safePage`; concurrent deletions can briefly show an empty state; (b) **silent no-op on expired session** in `refreshBrowseList`/`refreshSearchList`/`refreshFactsList` (back/confirm-delete/confirm-forget paths) — no "expired" followUp, unlike the pagination handlers. **Fix shape**: re-fetch at `safePage` when it differs from the requested page; add the expired followUp to the refresh helpers; also remove (or comment) the dead `xHelpers.isBrowseSelect` OR-branches in `handleSelectMenu` — both episode and fact select menus actually route via the detail `::select` id, so the browse-select checks never match (PR #1568 round-2 observation). Fix all copies together (reuse-scout consolidation rule). **Promote when**: next touching the browse/detail router pattern, or a user reports the phantom-empty-page. Surfaced 2026-07-09 (PR #1568 review, inherited from episode browse).

**Why:** Shared-pattern UX consistency; three copies must not drift.
<!-- SECTION:DESCRIPTION:END -->
