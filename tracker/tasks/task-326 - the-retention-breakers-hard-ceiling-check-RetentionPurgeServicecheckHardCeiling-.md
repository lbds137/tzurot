---
id: TASK-326
title: Serialize purge runs before a second caller exists (advisory lock)
status: To Do
assignee: []
created_date: '2026-07-25 00:00'
updated_date: '2026-07-28 10:52'
labels:
  - 'area:db'
  - 'origin:review'
  - 'area:api-gateway'
  - 'size:S'
dependencies: []
priority: low
ordinal: 326000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-25 (PR-D1 #1795 claude-review, non-blocking) — the retention breaker's hard-ceiling check (`RetentionPurgeService.checkHardCeiling`) and the per-user eligibility lookup are separate round-trips from the erasure transaction, so the ceiling is evaluated on stale-by-a-query data. **Provably a non-issue today**: the only caller is `retention:purge`'s explicitly sequential loop, and the real correctness gate (the D4 TOCTOU re-check) is inside the transaction. But "there are no concurrent callers" is an assumption nothing enforces. **Fix shape**: when a second caller exists, either serialize purge runs with a Postgres advisory lock or move the ceiling evaluation into the transaction — note the latter alone does NOT fix it (two transactions can each pass a count taken before the other commits), which is why the lock is the real answer. **Promote when**: Phase 4 (autonomous execution) is scoped — it IS the second automated caller — or any scheduled job starts calling the purge endpoint.

**Why:** Reviewer flagged it as an implicit, unenforced assumption rather than a defect; the trigger is a concrete future phase, not a vague someday. **Second member of the same assumption (PR-D1 review r5)**: `purgeUser` resolves the user row BEFORE opening the erasure transaction, so a concurrent purge (or a self-serve delete) removing that row in between makes `deleteAccount`'s `findUniqueOrThrow` raise a plain Prisma not-found rather than `RetentionIneligibleError` — which `eraseAndAudit` then records as a `failed` ledger row and the CLI reports as `FAILED` instead of the accurate `already_gone`. Cosmetic today (no corruption, the loop continues), and it shares this row's trigger exactly: it only becomes reachable when a second caller exists. Harden alongside the lock — catching Prisma P2025 in `eraseAndAudit` and mapping it to the already-gone skip is the narrow fix.
<!-- SECTION:DESCRIPTION:END -->
