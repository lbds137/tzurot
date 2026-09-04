---
id: TASK-252
title: Re-check main-pool idle-in-tx GUC if interactive transactions arrive
status: To Do
assignee: []
created_date: '2026-07-12 00:00'
updated_date: '2026-09-04 19:56'
labels:
  - 'area:db'
  - 'origin:review'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: low
ordinal: 252000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Re-check main-pool idle-in-tx GUC if interactive transactions arrive — The 60s `idle_in_transaction_session_timeout` (#1606) is safe today because nothing holds a Postgres transaction across external I/O — reviewer verified zero `$transaction`/manual-BEGIN usage in the codebase. A future interactive-transaction pattern (e.g. a `$transaction` block awaiting an LLM/API call between statements) could idle past 60s and get reaped mid-work. **Promote when**: any PR introduces `$transaction`/interactive-transaction usage (grep is the check). Surfaced 2026-07-12 (#1606 review).

**Why:** Guard-vs-future-pattern interaction; invisible until someone writes the first interactive transaction.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:56
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-21 (Theme Synchronous Work Timeout Budgets); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-252 finds it.
---
<!-- COMMENTS:END -->
