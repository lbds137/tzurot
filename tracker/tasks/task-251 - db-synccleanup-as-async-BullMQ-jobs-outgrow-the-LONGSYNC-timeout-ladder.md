---
id: TASK-251
title: db-sync/cleanup as async BullMQ jobs (outgrow the LONG_SYNC timeout ladder)
status: To Do
assignee: []
created_date: '2026-07-11 00:00'
updated_date: '2026-07-28 10:53'
labels:
  - 'area:api-gateway'
  - 'area:jobs'
  - 'size:M'
dependencies: []
priority: medium
ordinal: 251000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
db-sync/cleanup as async BullMQ jobs (outgrow the LONG_SYNC timeout ladder) — Both routes' duration scales with table size; a fact-carrying db-sync outgrew the 30s tier (succeeded server-side AFTER the client aborted — false-failure UX) and was raised to LONG_SYNC (300s) as the owner-chosen stopgap. **Fix shape**: gateway enqueues a sync/cleanup job + returns a job id; bot polls or receives the result via followUp (export_jobs is the in-house precedent); route timeout drops back to WRITE tier. **Data point (2026-07-13)**: owner observed dev db-sync 'very slow' during the fact-backfill's heavy write phase (extraction + embedding writes contending; memory_facts at ~20k rows with 3 protected indexes); it recovered — the caught-up run completed in 32s. Transient load-coupled, not promoted yet. **Promote when**: `Sync complete` log timestamps show any run past ~2 min under NORMAL load, OR a third route wants the LONG_SYNC exemption (the manifest test's comment marks that as the trigger), OR a sync ever fails to CONVERGE on retry (converge-on-retry is the accepted degraded mode — owner declined a 120s stopgap as "not worth the churn").

**Why:** The structural fix the timeout ladder defers to — decouple the operation's duration from any HTTP timeout. The timeout ladder has no headroom left: the manifest caps `timeoutMs` at 60s, so LONG_SYNC (300s) is an exemption, not a tier.

**Absorbed duplicates (labeling pass)**: TASK-130 (surfaced 2026-05-30, beta.126 smoke — db-sync false "Request timeout (HTTP 0)" at 10s while the gateway completed ~0.8s later; the original surfacing) and TASK-216 (surfaced 2026-07-06, beta.149 day-one — two server-side completions aborted client-side at exactly the ~30s BULK_OPERATION budget, third attempt converged at 7410ms; upserts are idempotent, retries converge, nothing lost). Both archived; this is the single canonical async-rework item. Related: the /admin db-sync silent-death prod issue (now.md) names this rework as the structural escape from the long-lived-HTTP-request class. Surfaced 2026-07-11 (owner-hit false failure; prior intent recorded in the route comment).
<!-- SECTION:DESCRIPTION:END -->
