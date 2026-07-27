---
id: TASK-292
title: 'my-aliases shadow probe is APPROXIMATE at extreme scale: the batched personality.findMany…'
status: To Do
assignee: []
created_date: '2026-07-18 00:00'
labels:
  - 'origin:review'
dependencies: []
ordinal: 292000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-18 (#1702 r1 observation) — my-aliases shadow probe is APPROXIMATE at extreme scale: the batched `personality.findMany` match query is bounded at `take: MAX_LIST_ROWS` (100), but one alias text can match multiple rows (name AND slug, or several same-named characters), so a caller with >100 visible name/slug collisions could get a false `shadowed: false` on later aliases. Documented in-code at the query; needs ~100+ colliding characters visible to ONE caller — far beyond current scale. **Fix shape**: bump the bound (2× alias count) or aggregate per-alias existence instead of row-capping. **Promote when**: the PR-4 browse ⚠️ badge under-reports in practice, or any caller's visible character fleet approaches triple digits.

**Why:** Only affects the caller's own badge accuracy — never privacy; the in-code comment marks the spot.
<!-- SECTION:DESCRIPTION:END -->
