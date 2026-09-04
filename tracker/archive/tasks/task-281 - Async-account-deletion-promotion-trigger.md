---
id: TASK-281
title: Async account-deletion promotion trigger
status: To Do
assignee: []
created_date: '2026-07-15 00:00'
updated_date: '2026-09-04 19:56'
labels:
  - 'area:api-gateway'
  - 'size:M'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 281000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Async account-deletion promotion trigger — Deletion runs synchronously in one 60s-timeout transaction (owner-decided: atomicity beats a job that could leave a half-deleted account); the route logs completion via the ACCOUNT DELETED warn line. **Fix shape**: promote to a queued job with progress reporting ONLY if real deletions approach the interaction window. **Promote when**: logged deletion duration p95 >10s. Surfaced 2026-07-15 (PR-B design D1).

**Why:** The transaction is the correctness win; async is a latency optimization with a measurable trigger.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:56
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-21 (Theme Synchronous Work Timeout Budgets); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-281 finds it.
---
<!-- COMMENTS:END -->
