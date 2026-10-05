---
id: TASK-1177
title: >-
  Memory retrieval misses most of the best matches: IVFFlat probes=1 with
  persona/personality post-filtering
status: Done
assignee: []
created_date: '2026-10-05 05:17'
updated_date: '2026-10-05 14:33'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 1168000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: measured 2026-10-05 on dev (pgvector 0.8.1, 47,198 memories) while testing the TASK-1174 Lilith import. The owner asked Lilith about an imported conversation and recall failed, although the imported row was the best match. Retrieval (services/ai-worker/src/services/PgvectorQueryBuilder.ts: ORDER BY embedding <=> query LIMIT n, WHERE persona_id/personality_id/visibility) runs with the default ivfflat.probes = 1 (SHOW ivfflat.probes = 1; git grep probes finds no setting in services/). With lists = 50 (docs/reference/operations/PRISMA_PGVECTOR_REFERENCE.md) the planner uses idx_memories_embedding, scans one list and THEN filters by persona and personality, so most true neighbours are never seen.
Measured (Lilith plus owner persona, about 6,000 candidate rows, top 20 against an exact search with enable_indexscan off), 5 queries: overlap with the exact top 20 at probes=1 was 0, 2, 2, 14, 0 of 20; at probes=10 it was 7, 14, 13, 20, 8 of 20. Exact top similarity vs returned top: 0.724 vs 0.559 and 0.665 vs 0.548. The live diagnostic for the failing request (llm_diagnostic_logs, 2026-10-05 09:12Z) returned 20 memories with best score 0.664 while the exact best was 0.841, and none of the imported rows. This affects every character and every user, not only imports; prod is likely the same (memories are db-synced).
What: make retrieval return the true nearest neighbours within the persona/personality filter. Candidates to measure (latency on prod-sized data, recall against exact): exact search for the filtered query, SET LOCAL ivfflat.probes in the query transaction, pgvector 0.8 iterative index scans (ivfflat.iterative_scan), or HNSW. The same check applies to memory_facts (idx_memory_facts_embedding, also IVFFlat lists=50).
Acceptance: for a fixed query set, retrieval top 20 matches the exact top 20 (or a measured recall target the owner accepts) on dev, with latency recorded; a test pins the setting that makes it so; the Lilith recall test (ask about Haida and Inui) surfaces the imported memory.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Closed 2026-10-05. Shipped as PR 2577 in beta.234. Clauses 1-2 met (dev recall@20 57/200 -> 200/200 with latency recorded; vectorSearch.test.ts pins the setting). Clause 3 (live Lilith recall) FAILED on prod, but not on this mechanism: the live top-20 now equals an exact re-run (less today's in-channel rows excluded by excludeNewerThan). The imported Haida memories score 0.683 at best against the owner's query (rank 583/6,647; cutoff 0.751): an embedding-similarity limit, moved to TASK-1181 (lexical retrieval leg).
<!-- SECTION:NOTES:END -->
