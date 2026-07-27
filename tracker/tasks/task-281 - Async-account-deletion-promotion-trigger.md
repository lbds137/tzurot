---
id: TASK-281
title: 'Async account-deletion promotion trigger'
status: To Do
assignee: []
created_date: '2026-07-15 00:00'
labels: []
dependencies: []
ordinal: 281000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Async account-deletion promotion trigger — Deletion runs synchronously in one 60s-timeout transaction (owner-decided: atomicity beats a job that could leave a half-deleted account); the route logs completion via the ACCOUNT DELETED warn line. **Fix shape**: promote to a queued job with progress reporting ONLY if real deletions approach the interaction window. **Promote when**: logged deletion duration p95 >10s. Surfaced 2026-07-15 (PR-B design D1).

**Why:** The transaction is the correctness win; async is a latency optimization with a measurable trigger.
<!-- SECTION:DESCRIPTION:END -->
