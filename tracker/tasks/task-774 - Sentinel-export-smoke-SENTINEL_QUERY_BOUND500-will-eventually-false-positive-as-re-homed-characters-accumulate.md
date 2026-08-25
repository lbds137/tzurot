---
id: TASK-774
title: >-
  Sentinel export-smoke SENTINEL_QUERY_BOUND=500 will eventually false-positive
  as re-homed characters accumulate
status: To Do
assignee: []
created_date: '2026-08-25 22:58'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 774000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the orphan sentinel only grows — every retention purge re-homes more characters onto it and nothing purges FROM it. The export-smoke counts snapshot (services/api-gateway/src/routes/internal/exportSmoke.ts, SENTINEL_QUERY_BOUND) truncates at 500 rows while the real assembler is unbounded, so once the sentinel crosses ~500 characters the weekly smoke flags a permanent expected-vs-got count mismatch on every run — a false alarm, not a pipeline break. Review finding on PR #2224 (claude-review, Low/forward-looking).
Fix shape: either count-check directly (COUNT aggregates instead of bounded findMany id sweeps — no truncation possible), or raise/remove the bound with a guard that reports its own truncation as an explicit finding instead of a silent skew. Retention cadence gives a rough ETA; nowhere near 500 today.
Acceptance: the smoke cannot silently produce a count-mismatch finding caused by its own snapshot bound.
<!-- SECTION:DESCRIPTION:END -->
