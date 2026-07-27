---
id: TASK-176
title: 'Fast-pool timeout PR #1343 code-polish nits (3, all genuinely minor)'
status: To Do
assignee: []
created_date: '2026-06-25 00:00'
labels:
  - 'area:db'
dependencies: []
ordinal: 176000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Fast-pool timeout PR #1343 code-polish nits (3, all genuinely minor)

**Why:** From #1343 round-2 claude-review, all explicitly "minor": (1) `verifyPoolTimeouts` (`prisma.ts`) asserts only `statement_timeout`+`lock_timeout`, not `idle_in_transaction_session_timeout` — extend the `pg_settings` `WHERE IN` + expected for completeness (low value: idleInTx is hardcoded, a full `options` strip is already caught); (2) the `query-timeout-or-dead-conn` case has no HANDLER-level test (only exhaustive coverage in `dbTimeout.test.ts`) — add an `it` block or a comment noting the intentional asymmetry; (3) the fast-pool-timeout `catch` comment in both persist handlers documents WHAT ("asyncHandler turns it into the gateway's 5xx") not WHY — reword per 02-code-standards to "classify before rethrowing so the 5xx carries the diagnostic label in logs." **Promote when**: next touching the fast-pool code, or a polish pass. Surfaced 2026-06-25 by PR #1343 round-2 claude-review.
<!-- SECTION:DESCRIPTION:END -->
