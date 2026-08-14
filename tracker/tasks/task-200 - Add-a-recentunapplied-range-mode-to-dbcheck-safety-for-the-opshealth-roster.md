---
id: TASK-200
title: 'Add a recent/unapplied-range mode to db:check-safety for the ops:health roster'
status: To Do
assignee: []
created_date: '2026-07-03 00:00'
updated_date: '2026-08-14 11:22'
labels:
  - 'area:tooling'
  - 'area:db'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 200000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add db:check-safety back to the ops:health roster

**Why (original, 2026-07-03):** a bare run scanned ALL historical migrations and re-flagged applied, reviewed ones forever (26 findings, e.g. Feb 2026 drops) — perma-red in aggregate mode, so it was pulled from HEALTH_TOOLS. Original fix shape was a --range/--recent mode.

**RE-VERIFIED 2026-08-14 — the premise is stale and the --range mode is no longer needed.** `pnpm ops db:check-safety` now reports `All migrations are safe` across all 120 migration files, 0 findings. The cause of the old 26 was comment-blind matching: the drift sanitizer leaves `-- REMOVED: DROP INDEX ...` markers in sanitized migrations and the regex flagged every one as a live drop. check-migration-safety.ts:87-93 now strips SQL line comments before matching, which closed the whole class. A --range mode would add a scoping knob to a tool that has nothing left to scope away, and would COST coverage: the full-history scan is what catches a hand-edited old migration.

Remaining action is roster-only: add `db:check-safety` to HEALTH_TOOLS in packages/tooling/src/audits/health.ts. It already emits the standardized JSONL summary (emitSummary with tool db:check-safety, baseline 0), so no summary-contract work is needed.

Acceptance: db:check-safety appears in HEALTH_TOOLS; `pnpm ops health` runs it and reports ok; the roster test covers the added entry.
<!-- SECTION:DESCRIPTION:END -->
