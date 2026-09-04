---
id: TASK-254
title: contextFoldTurns as a ConfigOverrides cascade field
status: To Do
assignee: []
created_date: '2026-07-12 00:00'
updated_date: '2026-09-04 20:05'
labels:
  - 'area:config-resolver'
  - 'area:common-types'
  - 'size:M'
  - 'state:dependent'
dependencies: []
priority: low
ordinal: 254000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`contextFoldTurns` as a `ConfigOverrides` cascade field — The fold turn-count is a hardcoded constant (`AI_DEFAULTS.LTM_SEARCH_HISTORY_TURNS = 3`, read in `extractRecentHistoryWindow`). 1c PR-1 makes it a defaulted param for the eval sweep; making it user/admin-TUNABLE at runtime needs the full field-#12 cascade ceremony (schema field + `NULL_TERMINAL_FIELDS`/`CONFIG_OVERRIDES_KEYS`/`HARDCODED_CONFIG_DEFAULTS` + colocated drift test + dashboard family + source label). **Promote when**: the 1c turn-sweep (3/5/8) shows N materially moves recall — build the knob only if the measurement justifies it. Surfaced 2026-07-12 (1c re-baseline plan).

**Why:** Measure-first: don't build the cascade field before the sweep proves N matters.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 20:05
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-8 (Theme Memory System Overhaul — PARKED MID EPIC 2026 07 17); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-254 finds it.
---
<!-- COMMENTS:END -->
