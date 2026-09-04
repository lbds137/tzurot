---
id: TASK-190
title: >-
  /preset browse transfers the full config set on every pagination/filter
  interaction
status: To Do
assignee: []
created_date: '2026-06-29 00:00'
updated_date: '2026-09-04 20:02'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 190000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`/preset browse` transfers the full config set on every pagination/filter interaction

**Why:** S4b-1 (#1395) moved the second filter axis (text/vision) from a server-scoped fetch to **always-fetch-all-then-filter client-side** (`fetchPresets` hardcodes `kind: 'all'`; `filterPresets` applies scope+capability in-memory). Necessary — capability (`supportsVision`) is model-derived, not a server-filterable column — but it means every page-turn / filter-change re-transfers the user's entire config set. Fine for typical config counts; a user with a large config set may feel filter changes get slightly slower. **Fix shape**: if it becomes observable, cache the fetched config list per browse session (keyed on the browse message id, like the existing dashboard session pattern) so pagination/filter reuses it instead of re-fetching, OR add server-side capability filtering once `supportsVision` is a persisted/queryable column. **Promote when**: a user reports sluggish `/preset browse` filter/pagination, or config counts grow large enough to matter. Surfaced 2026-06-29 by PR #1395 (S4b-1) claude-review (non-blocking, acceptable trade-off).
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 20:02
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-92 (Idea Scale gated watches — threshold inventory for the single instance ceiling); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-190 finds it.
---
<!-- COMMENTS:END -->
