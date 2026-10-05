---
id: TASK-1181
title: 'Add a lexical leg to memory retrieval so rare names (Haida, Inui) are found'
status: To Do
assignee: []
created_date: '2026-10-05 14:32'
labels:
  - 'area:ai-worker'
  - 'size:L'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1171000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: after PR 2577 (beta.234) retrieval is exact, verified on prod 2026-10-05: the live Lilith request's top-20 (scores 0.772-0.751, persona 57240faf) matches an exact re-run once today's in-channel rows (excluded by excludeNewerThan, by design) are removed. Yet the owner's recall test still failed. Measured on prod (read-only): 10 imported memories literally contain Haida; against the owner's actual 123-char query their best cosine similarity is 0.683, rank 583 of 6,647 in the pool, while the top-20 cutoff is 0.751. A keyword-style query (Haida and Inui from Aggretsuko) scores them only 0.48-0.67. The embedding model (bge-small-en-v1.5) carries rare proper nouns weakly, and the imported rows are 1.6k-2.4k chars (two-turn exchanges), which dilutes them further and may exceed the 512-token model window.

What: a lexical leg beside the vector search, e.g. Postgres full-text (tsvector plus GIN index) or pg_trgm on memories.content, merged with the vector results (reciprocal-rank fusion or a reserved slot count). Searched for an existing one: git grep for tsvector, ts_rank, to_tsquery, pg_trgm, bm25, hybrid, lexical in services/packages/prisma (non-test) found none. Also consider chunking long imported exchanges.

Acceptance: the owner's Haida/Inui question on dev surfaces at least one imported Haida memory; the change ships with recall numbers on a fixed query set (vector-only vs hybrid) and latency.
Promote when: next week's usage window (schema + retrieval change; owner sees the design first).
<!-- SECTION:DESCRIPTION:END -->
