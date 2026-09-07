---
id: TASK-910
title: 'memory:summarize ergonomics: addBulk enqueue and a --limit truncation notice'
status: To Do
assignee: []
created_date: '2026-09-07 21:26'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 908000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the pre-warm sweep (packages/tooling/src/memory/summarize-sweep.ts) adds jobs one queue.add at a time, the same shape backfill-facts.ts uses, so a 5000-row personality-scale run pays one Railway-proxy round trip per row; and the report prints no signal when the hot selection hit --limit, so an operator watching the gate plateau cannot tell done from capped. Both raised by claude-review on PR 2358 (rounds 1 and 6) as nits; neither affects correctness.
Fix shape: replace the per-row loop with queue.addBulk per 200-row batch, keeping per-job jobId, priority, and the shared ARCHIVE_SUMMARY_JOB_OPTIONS (assert the bulk payload at the seam); add a line under Selection reading hot selection capped by --limit (N eligible beyond the cap) when the hot query returns exactly the limit, computed with a COUNT of the same predicate.
Acceptance: a 5000-row dry run is not the bottleneck against the model queue; the truncation line appears in the report when and only when the cap binds.
<!-- SECTION:DESCRIPTION:END -->
