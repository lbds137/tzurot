---
id: TASK-190
title: '/preset browse transfers the full config set on every pagination/filter interaction'
status: To Do
assignee: []
created_date: '2026-06-29 00:00'
labels: []
dependencies: []
ordinal: 190000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`/preset browse` transfers the full config set on every pagination/filter interaction

**Why:** S4b-1 (#1395) moved the second filter axis (text/vision) from a server-scoped fetch to **always-fetch-all-then-filter client-side** (`fetchPresets` hardcodes `kind: 'all'`; `filterPresets` applies scope+capability in-memory). Necessary — capability (`supportsVision`) is model-derived, not a server-filterable column — but it means every page-turn / filter-change re-transfers the user's entire config set. Fine for typical config counts; a user with a large config set may feel filter changes get slightly slower. **Fix shape**: if it becomes observable, cache the fetched config list per browse session (keyed on the browse message id, like the existing dashboard session pattern) so pagination/filter reuses it instead of re-fetching, OR add server-side capability filtering once `supportsVision` is a persisted/queryable column. **Promote when**: a user reports sluggish `/preset browse` filter/pagination, or config counts grow large enough to matter. Surfaced 2026-06-29 by PR #1395 (S4b-1) claude-review (non-blocking, acceptable trade-off).
<!-- SECTION:DESCRIPTION:END -->
