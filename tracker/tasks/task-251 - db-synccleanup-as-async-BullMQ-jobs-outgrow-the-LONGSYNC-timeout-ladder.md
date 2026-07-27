---
id: TASK-251
title: 'db-sync/cleanup as async BullMQ jobs (outgrow the LONG_SYNC timeout ladder)'
status: To Do
assignee: []
created_date: '2026-07-11 00:00'
labels:
  - 'area:embeddings'
  - 'area:jobs'
dependencies: []
ordinal: 251000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

db-sync/cleanup as async BullMQ jobs (outgrow the LONG_SYNC timeout ladder) — Both routes' duration scales with table size; a fact-carrying db-sync outgrew the 30s tier (succeeded server-side AFTER the client aborted — false-failure UX) and was raised to LONG_SYNC (300s) as the owner-chosen stopgap. **Fix shape**: gateway enqueues a sync/cleanup job + returns a job id; bot polls or receives the result via followUp (export_jobs is the in-house precedent); route timeout drops back to WRITE tier. **Data point (2026-07-13)**: owner observed dev db-sync 'very slow' during the fact-backfill's heavy write phase (extraction + embedding writes contending; memory_facts at ~20k rows with 3 protected indexes); it recovered — the caught-up run completed in 32s. Transient load-coupled, not promoted yet. **Promote when**: `Sync complete` log timestamps show any run past ~2 min under NORMAL load, OR a third route wants the LONG_SYNC exemption (the manifest test's comment marks that as the trigger). Surfaced 2026-07-11 (owner-hit false failure; prior intent recorded in the route comment).

**Why:** The structural fix the timeout ladder defers to.
<!-- SECTION:DESCRIPTION:END -->
