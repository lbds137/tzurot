---
id: TASK-280
title: Expression index for the case-insensitive entity_tags sweep
status: To Do
assignee: []
created_date: '2026-07-15 00:00'
updated_date: '2026-09-04 20:00'
labels:
  - 'area:db'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 280000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Expression index for the case-insensitive entity_tags sweep — Account deletion's fact sweep (`DELETE FROM memory_facts f WHERE EXISTS (SELECT 1 FROM unnest(f.entity_tags) t(tag) WHERE lower(t.tag) = ANY($1::text[]))`) seq-scans memory_facts — fine at current scale, owner-accepted. **Fix shape**: GIN expression index over lowered tags (e.g. index on `(SELECT array_agg(lower(t)) FROM unnest(entity_tags) t)` via an immutable helper, or normalize tags to lowercase at write time and use a plain GIN + `@>`). Index must land with the query per 03-database. **Promote when**: memory_facts >~100k rows or observed sweep slowness in the deletion-duration logs. Surfaced 2026-07-15 (PR-B design D3).

**Why:** Deletion is rare; a write-path tax on every fact insert needs scale evidence first.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 20:00
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-3 (Theme Database Performance Audit); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-280 finds it.
---
<!-- COMMENTS:END -->
