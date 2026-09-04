---
id: TASK-774
title: >-
  Sentinel export-smoke SENTINEL_QUERY_BOUND=500 will eventually false-positive
  as re-homed characters accumulate
status: To Do
assignee: []
created_date: '2026-08-25 22:58'
updated_date: '2026-09-04 19:38'
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

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:38
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. `exportSmoke.ts` still hard-bounds all four sentinel-count queries at `SENTINEL_QUERY_BOUND = 500` while the real assembler is unbounded — once the orphan sentinel crosses ~500 characters the weekly smoke will permanently false-positive. No count-based rewrite or truncation-reporting guard added yet. Cannot verify current sentinel size read-only, but the code-level ratchet-toward-failure is unambiguous and self-inflicted (nothing purges FROM the sentinel). Evidence: `grep -n "SENTINEL_QUERY_BOUND" services/api-gateway/src/routes/internal/exportSmoke.ts` → constant = 500, used at 4 query sites (lines 97, 102, 182, 194).
---
<!-- COMMENTS:END -->
