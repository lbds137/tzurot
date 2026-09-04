---
id: TASK-335
title: ResponseOrderingService is single-replica by design
status: To Do
assignee: []
created_date: '2026-07-27 00:00'
updated_date: '2026-09-04 20:03'
labels:
  - 'area:bot-client'
  - 'area:jobs'
  - 'area:redis'
  - 'size:L'
  - 'state:dependent'
dependencies: []
priority: low
ordinal: 335000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-27 (system-model map §4; owner: known lies need backlog items) — **`ResponseOrderingService` is single-replica by design** (flagged in-code) — the ordering queue state lives in-process, so a second bot-client replica would break strict reply ordering. Fine today (Discord gateway keeps bot-client single-replica); becomes real work at sharding time. **Fix shape**: externalize ordering state (Redis) or partition by channel across replicas — design task, not a patch. **Promote when**: bot-client scaling/sharding lands on the roadmap. Related: the `adoptRehydratedEntry` ordering-state-leak row above.

**Why:** In-code-flagged scaling blocker; tracked so the map's §4 entry has a home beyond the map.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 20:03
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-92 (Idea Scale gated watches — threshold inventory for the single instance ceiling); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-335 finds it.
---
<!-- COMMENTS:END -->
