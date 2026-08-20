---
id: TASK-679
title: >-
  Roster-blurb sweep runs two unindexed scans over personalities every 10
  minutes
status: To Do
assignee: []
created_date: '2026-08-19 12:49'
labels:
  - 'area:db'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 679000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: rosterBlurbSweep runs on a `4,14,24,34,44,54 * * * * (corrected — the filed 3,13,… schedule was changed in commit 125dd3b5a; TASK-681 records why)` cron forever. Both of its queries are unindexed over personalities — the stamping pass filters `card_source_hash IS NULL`, and findStale compares `roster_blurb_source_hash IS DISTINCT FROM card_source_hash`, a two-column comparison no ordinary index can serve.

Not fixed at authoring time on merit, not deferral: 03-database.md § Indexes Ship With Their Query warns that a speculative index costs write-path maintenance immediately while its read benefit may never arrive. personalities holds one row per character definition, so a seq scan every 10 minutes is currently far cheaper than maintaining an index on a table that takes writes on every character edit and import.

Promote when: personalities exceeds ~10k rows, or the sweep shows up in slow-query logs. Fix shape: a partial index on `(card_source_hash) WHERE card_source_hash IS NULL` serves the stamping pass and shrinks to empty once it drains; the IS DISTINCT FROM comparison needs an expression index or a generated is_stale column, which is the part that needs design.

Raised by the PR #2149 round-2 review; verified the queries and the cron against services/ai-worker/src/jobs/rosterBlurbSweep.ts and services/ai-worker/src/index.ts.
<!-- SECTION:DESCRIPTION:END -->
