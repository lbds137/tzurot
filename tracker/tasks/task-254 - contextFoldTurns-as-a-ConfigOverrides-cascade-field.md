---
id: TASK-254
title: 'contextFoldTurns as a ConfigOverrides cascade field'
status: To Do
assignee: []
created_date: '2026-07-12 00:00'
labels: []
dependencies: []
ordinal: 254000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`contextFoldTurns` as a `ConfigOverrides` cascade field — The fold turn-count is a hardcoded constant (`AI_DEFAULTS.LTM_SEARCH_HISTORY_TURNS = 3`, read in `extractRecentHistoryWindow`). 1c PR-1 makes it a defaulted param for the eval sweep; making it user/admin-TUNABLE at runtime needs the full field-#12 cascade ceremony (schema field + `NULL_TERMINAL_FIELDS`/`CONFIG_OVERRIDES_KEYS`/`HARDCODED_CONFIG_DEFAULTS` + colocated drift test + dashboard family + source label). **Promote when**: the 1c turn-sweep (3/5/8) shows N materially moves recall — build the knob only if the measurement justifies it. Surfaced 2026-07-12 (1c re-baseline plan).

**Why:** Measure-first: don't build the cascade field before the sweep proves N matters.
<!-- SECTION:DESCRIPTION:END -->
