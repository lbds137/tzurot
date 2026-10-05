---
id: TASK-1178
title: Decide the IVFFlat vector indexes' future now that searches run exact
status: To Do
assignee: []
created_date: '2026-10-05 06:11'
labels:
  - 'area:db'
  - 'size:M'
  - 'state:owner'
dependencies: []
priority: medium
ordinal: 1169000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: since TASK-1177 (PR 2577) every <=> query sets ivfflat.probes=32768 (packages/common-types/src/services/vectorSearch.ts), so results are exact. In the dev measurement the planner chose idx_memories_embedding / idx_memory_facts_embedding in 0 of 10 queries per target: both indexes cost write maintenance with no measured read benefit. Exact latency grows with rows per persona: ~31 ms at 6.6k rows (largest persona/personality pair), ~95 ms for a 22k-row persona-only memory search, ~82 ms for facts across all personalities (dev, 2026-10-05).

Owner question: keep, drop, or replace the IVFFlat indexes (HNSW or per-persona partial) once the largest pair passes a measured threshold?
Recommendation: keep for now — drop is a schema change with no current latency problem; re-measure exact latency when the largest persona/personality pair passes ~25k rows.

Acceptance: a recorded decision; if replace, a migration PR with before/after recall@20 and latency on dev.
<!-- SECTION:DESCRIPTION:END -->
