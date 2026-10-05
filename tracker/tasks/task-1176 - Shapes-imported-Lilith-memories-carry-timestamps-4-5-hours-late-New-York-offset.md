---
id: TASK-1176
title: >-
  Shapes-imported Lilith memories carry timestamps 4-5 hours late (New York
  offset)
status: To Do
assignee: []
created_date: '2026-10-05 00:47'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1167000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner-requested comparison 2026-10-04 of the shapes.inc export (~/Documents/Shapes/Lilith Gem/lilith-tzel-shani_memories.json, 2,262 non-empty entries) against prod memories for lilith-tzel-shani with source_system shapes-inc (2,759 rows), read-only, matched by sha256 of exact text: 2,241 matched, and EVERY matched row has prod created_at minus export metadata.created_at*1000 equal to +4h (1,666 rows) or +5h (575 rows), i.e. the America/New_York offset by DST. Text and ordering are intact; recall dates are off by hours. The import maps createdAt as m.metadata.created_at * 1000 (services/ai-worker/src/jobs/ShapesImportJob.ts:135), so the shift happens either in the export (local time encoded as epoch) or on the write path (MemoryMetadata.createdAt to the created_at column, e.g. a timestamp-without-time-zone round trip). Not yet determined which.
What: find the side that shifts (a unit test feeding a known epoch through importMemories and PgvectorMemoryAdapter.addMemory and reading created_at back; check the export semantics against one memory whose real time is known). If the write path shifts, fix it and check the other import paths (backfill-ltm, TASK-1174) share no such bug. Then correct existing shapes-inc rows with a reviewed one-off (dry run counts first, dev then prod with an owner go); rows are sync-tracked, so mind updated_at per 03-database.md.
Also seen, not acted on: 21 export entries have no exact-text match on prod (16 share their first 40 chars with a prod row, likely edited; 5 unexplained).
Acceptance: the root cause is named with a test; corrected rows match the export to the second.
<!-- SECTION:DESCRIPTION:END -->
