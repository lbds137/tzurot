---
id: TASK-196
title: 'Harvester dedup keys on bare constraint/index name, not (table, name)'
status: To Do
assignee: []
created_date: '2026-07-02 00:00'
labels:
  - 'area:db'
  - 'area:testing'
  - 'origin:review'
dependencies: []
ordinal: 196000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Harvester dedup keys on bare constraint/index name, not (table, name)

**Why:** `harvestLastWins` in `generate-schema.ts` dedups by the quoted name alone, across all three harvesters (CHECK, partial-unique, DEFERRABLE). Prisma's `<table>_<column>_fkey`/`_key` naming makes cross-table collisions effectively impossible today, but a hand-written migration using a bare name (e.g. `"valid_range"` on two tables) would last-wins-collapse to ONE statement and silently drop the other from `pglite-schema.sql`. **Fix shape**: key the dedup map on `table + name` (the regexes already match the quoted table — promote it to a capture group). **Promote when**: a hand-written migration introduces a constraint/index name that isn't table-prefixed, or next touching the harvest kernel. Surfaced 2026-07-02 (PR #1458 review — latent, pre-existing across all three harvesters).
<!-- SECTION:DESCRIPTION:END -->
