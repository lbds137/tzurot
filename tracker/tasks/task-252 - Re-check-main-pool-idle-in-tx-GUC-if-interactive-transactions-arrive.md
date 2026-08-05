---
id: TASK-252
title: Re-check main-pool idle-in-tx GUC if interactive transactions arrive
status: To Do
assignee: []
created_date: '2026-07-12 00:00'
updated_date: '2026-07-28 10:51'
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
