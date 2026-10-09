---
id: TASK-1199
title: >-
  Protected-index createPatterns are name-only - recreate shape (USING/lists,
  other WHERE predicates) is not checked
status: To Do
assignee: []
created_date: '2026-10-09 23:18'
labels:
  - 'area:tooling'
  - 'area:db'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1189000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
2026-10-09, from the #2597 review (round 1 finding 4): after TASK-608's per-statement matching, the other protected-index entries (idx_memories_embedding, idx_memory_facts_embedding, the llm_configs/tts_configs unique indexes) still use name-only createPatterns, so a recreate that changes the index shape passes the safety gate: an IVFFlat recreate with different USING/lists parameters, or a unique index recreated non-unique, is accepted. The chunk-group entry is the one that now pins its WHERE predicate. Fix shape: per-entry pattern tightening modeled on the chunk-group entry (match recreateSQL exactly), plus the real-drift-ignore.json pinning test from #2597's round-1 as the template. Cost is one pattern audit across the remaining entries; the failure mode is a silently degraded index, not data loss - low priority until a migration actually touches those indexes.
<!-- SECTION:DESCRIPTION:END -->
