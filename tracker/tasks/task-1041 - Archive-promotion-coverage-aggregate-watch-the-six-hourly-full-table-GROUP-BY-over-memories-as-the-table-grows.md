---
id: TASK-1041
title: >-
  Archive-promotion coverage aggregate: watch the six-hourly full-table GROUP BY
  over memories as the table grows
status: To Do
assignee: []
created_date: '2026-09-22 00:00'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 1035000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2470 (TASK-1038) runs ARCHIVE_COVERAGE_SQL (services/api-gateway/src/services/archivePromotionSql.ts) every six hours from the live gateway: a GROUP BY personality_id over every non-chunk memories row with two FILTER arms on last_retrieved_at, summary_status and summary_prompt_version, no covering index for that shape. The same class of query ran only ad hoc before (pnpm ops memory:summarize --dry-run, WINDOW_COUNTS_SQL). Review finding 5 on #2470; 03-database.md says an index ships with a query that needs it, not speculatively.
Watch signal: the gateway request log or the pg slow-query log showing the promotion route past a few hundred ms, or memories growing past the low hundreds of thousands of rows.
Fix shape: measure the query with EXPLAIN ANALYZE on prod (read-only); if it is the bottleneck, a partial index on (personality_id, last_retrieved_at) WHERE chunk_group_id IS NULL, shipped with this query as its named consumer.
Acceptance: the measurement recorded here, and either a no-change ruling with the numbers or the index landing in the same PR as the query change.

Member (review round 2 of #2470, finding 4, same query): MAX_PERSONALITIES_EVALUATED (1000) with ORDER BY retrieved_in_window DESC means a personality past the cap is never evaluated, not merely delayed, because the least-active always sort last. Documented as intentional in the module header; a defect only once the personality count approaches the cap. Watch signal: personality rows within an order of magnitude of 1000. Fix shape then: keyset pagination across runs (resume after the last personality_id of the previous sweep) so every personality is evaluated within a bounded number of runs. Ships in the same PR as any change to this query.
<!-- SECTION:DESCRIPTION:END -->
