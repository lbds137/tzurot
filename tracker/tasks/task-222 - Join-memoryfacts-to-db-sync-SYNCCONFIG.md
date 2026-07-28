---
id: TASK-222
title: Join memory_facts to db-sync SYNC_CONFIG
status: Done
assignee: []
created_date: '2026-07-06 00:00'
updated_date: '2026-07-28 13:08'
labels:
  - 'area:embeddings'
  - 'area:db'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 222000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Join `memory_facts` to db-sync SYNC_CONFIG — The table sits in EXCLUDED_TABLES while shadow-mode (empty, nothing reads it). Facts are non-regenerable user data like memories (no bulk re-extraction), so once real data flows they should sync like memories does — needs column list, FK map (incl. the supersededById self-FK ordering), and embedding handling in SyncUpsertBuilder. **Promote when**: memory Phase 2 slice 4 (retrieval integration) ships. Filed 2026-07-06 (slice 1 review cycle).

**Why:** Sync parity for the fact corpus.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verified shipped 2026-07-28: memory_facts has a full SYNC_CONFIG entry (LWW updated_at, uuidColumns incl. the superseded_by_id self-FK handled via the DEFERRABLE constraint from migration 20260710183055, tombstone trigger), sits in SYNC_TABLE_ORDER after its FK parents, and SyncUpsertBuilder carries MEMORY_FACTS_SYNC_COLUMNS with vectorColumn embedding. Every element of the filed fix shape exists in code.
<!-- SECTION:NOTES:END -->
