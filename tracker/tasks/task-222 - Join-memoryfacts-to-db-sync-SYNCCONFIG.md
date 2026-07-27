---
id: TASK-222
title: 'Join memory_facts to db-sync SYNC_CONFIG'
status: To Do
assignee: []
created_date: '2026-07-06 00:00'
labels:
  - 'area:embeddings'
dependencies: []
ordinal: 222000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Join `memory_facts` to db-sync SYNC_CONFIG — The table sits in EXCLUDED_TABLES while shadow-mode (empty, nothing reads it). Facts are non-regenerable user data like memories (no bulk re-extraction), so once real data flows they should sync like memories does — needs column list, FK map (incl. the supersededById self-FK ordering), and embedding handling in SyncUpsertBuilder. **Promote when**: memory Phase 2 slice 4 (retrieval integration) ships. Filed 2026-07-06 (slice 1 review cycle).

**Why:** Sync parity for the fact corpus.
<!-- SECTION:DESCRIPTION:END -->
