---
id: TASK-301
title: 'PersonalitySummarySchema (list/browse responses) carries hasAvatar but not avatarUrl;…'
status: To Do
assignee: []
created_date: '2026-07-19 00:00'
labels:
  - 'area:bot-client'
  - 'origin:review'
dependencies: []
ordinal: 301000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-19 (#1730 review observation) — `PersonalitySummarySchema` (list/browse responses) carries `hasAvatar` but not `avatarUrl`; fine today (no browse surface renders thumbnails), but a future browse-thumbnail feature reaching for `hasAvatar` and hand-building a URL from bot-client's internal gateway base would recreate the exact broken-image bug class #1730 fixed (Discord's media proxy can't reach the internal hostname). **Fix shape**: extend `PersonalitySummarySchema` + the list formatter with the same gateway-derived `avatarUrl` field; never hand-build client-side. **Promote when**: any browse/list surface wants avatar thumbnails.

**Why:** The bug class has bitten twice; the schema field is the structural fix — this row makes the third occurrence impossible to write innocently.
<!-- SECTION:DESCRIPTION:END -->
