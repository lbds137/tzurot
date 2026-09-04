---
id: TASK-289
title: Partial index for the broadcast eligibility scan (scale-gated)
status: To Do
assignee: []
created_date: '2026-07-16 00:00'
updated_date: '2026-09-04 20:01'
labels:
  - 'origin:review'
  - 'area:api-gateway'
  - 'area:db'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 289000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-16 (#1679 r2 observation) — the release-broadcast eligibility scan (`resolveEligibleRecipients`: `notifyEnabled` + `notifyOptedInAt` + `notifyLevel`) has no backing index on `users` — full-table scan, once per release. Correct-as-is at current scale (~hundreds of rows; an index would tax every user-row write for a query that runs a few times a month). **Fix shape**: partial index (e.g. on `notify_level` WHERE `notify_enabled AND notify_opted_in_at IS NOT NULL`), landing WITH the query per 03-database. Same disposition for the retention job's daily `release_delivery_log` sweep (#1683 r1 obs: filters `createdAt`+`status`, only `[releaseId,userId]`/`[userId]` indexes exist — full-table scan, fine at ~hundreds of rows/release). **Promote when**: users table >~50k rows, delivery-log >~100k rows, or broadcast-enqueue latency becomes visible in logs.

**Why:** Index-ships-with-its-query cuts both ways: no scale evidence yet, write-path tax is real, trigger is measurable. Same scale trigger for the resweep wedge heuristic itself (#1683 r5): a genuinely slow >30min blast (thousands of recipients) would be re-enqueued hourly until drained — harmless (pre-filter) but wasteful; revisit the threshold or add an in-flight check alongside the index work.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 20:01
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-3 (Theme Database Performance Audit); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-289 finds it.
---
<!-- COMMENTS:END -->
