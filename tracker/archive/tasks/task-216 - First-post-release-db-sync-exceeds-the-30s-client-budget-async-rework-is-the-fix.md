---
id: TASK-216
title: 'First-post-release db-sync exceeds the 30s client budget (async rework is the fix)'
status: To Do
assignee: []
created_date: '2026-07-06 00:00'
labels: []
dependencies: []
ordinal: 216000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

First-post-release db-sync exceeds the 30s client budget (async rework is the fix)

**Why:** Measured on beta.149 day-one syncs: two server-side completions aborted client-side at exactly the `BULK_OPERATION` budget (29997ms/29995ms), third attempt converged at 7410ms — the gateway always finishes, upserts are idempotent, retries converge, so nothing is lost. Cause stack: first-run-after-a-gap carries the accumulated delta + #1497 restored full-width memories rows (the rotted SELECT had been syncing narrow) + two new memories indexes tax every upsert. Owner declined a 120s stopgap ("not worth the churn") — the durable fix is the async-job-with-progress db-sync rework already designed in the accepted UX spec (the route's own comment names it). **Promote when**: the UX boulder's db-sync phase builds, OR immediately if a sync ever fails to CONVERGE on retry (converge-on-retry is the accepted degraded mode). Surfaced 2026-07-06 (beta.149 smoke; prod logs).
<!-- SECTION:DESCRIPTION:END -->
