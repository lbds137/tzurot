---
id: TASK-1176
title: >-
  Shapes-imported Lilith memories carry timestamps 4-5 hours late (New York
  offset)
status: To Do
assignee: []
created_date: '2026-10-05 00:47'
updated_date: '2026-10-05 00:53'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Side finding 2026-10-05 (read-only prod): of the 2,759 shapes-inc lilith-tzel-shani rows, about 717 have a persona_id with no matching personas row (an inner join on personas drops them; a left join keeps 2,759). Not investigated: whether memories.persona_id lacks a foreign key or those personas were deleted without cascading. The 21-entry follow-up: 20 of the 21 unmatched export entries have an owner-persona prod row at the export timestamp +4h/+5h, so they are most likely post-import edits (dump for the Characters session at ~/Projects/tzurot-characters/export/shapes-compare-2026-10-04/unmatched.json, uncommitted).

Characters-session follow-up 2026-10-05: all 21 unmatched export entries are explained: prod has the token {assistant} where the export has "Lilith:" (prod.replace({assistant}, Lilith) equals the export text exactly, 21/21; updated_at 2026-01-09 suggests a one-off normalisation pass). Harmless: mapQueryResultToDocument (services/ai-worker/src/utils/memoryUtils.ts) resolves {assistant} to the personality name at retrieval (code-read). Residue, cosmetic: 3 export entries still carry a literal "Lilith:" on prod (indexes 779, 977, 1373), and at least one blank memory row exists (content a single space, id prefix 491983fb, export index 1443; a second blank export entry, index 1894, not placed). Decide whether blank rows should be filtered when this task touches the import path.
<!-- SECTION:NOTES:END -->
