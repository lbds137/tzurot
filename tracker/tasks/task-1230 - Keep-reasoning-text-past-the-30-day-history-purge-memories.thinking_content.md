---
id: TASK-1230
title: Keep reasoning text past the 30-day history purge (memories.thinking_content)
status: To Do
assignee: []
created_date: '2026-10-15 15:25'
labels:
  - 'area:memory'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 1219000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the daily 09:10 UTC retention sweep (ai-worker scheduledJobSchedule.ts, cleanupOldHistory, DAYS_TO_KEEP_HISTORY=30 in timing.ts) hard-deletes conversation_history rows; memories.content keeps the user+assistant text verbatim, but thinking_content lives only in history, so reasoning older than 30 days is lost every day. Prod 2026-10-15: oldest live history row 2026-09-15.

Owner ruling 2026-10-15: reasoning text is worth keeping; apply to ALL LTM users (not opt-in), with a privacy-policy line.

What: nullable memories.thinking_content (null = turn had no reasoning, or predates the column) written alongside storeInteraction; one-off backfill from live conversation_history for turns still in the window; include in account export and /memory view; NEVER rendered to the character (doc-97 self-prose loop); PRIVACY_POLICY.md line.

Acceptance: new turns store reasoning in memories; backfill verified read-only on prod; purge leaves reasoning recoverable from memories.

Stopgap until shipped: owner runs /settings data export (includes Reasoning blocks) every ~25 days.

Progress 2026-10-18: PR 2629 merged (schema, write path, export, /memory Reasoning button, privacy line, memory:backfill-thinking, sync keepNonNullColumns). Owner rulings during review: keep the trace when a memory is edited; skip soft-deleted history rows in the backfill; privacy sentence notes the trace may paraphrase other conversation messages. Dev: migrated and backfilled (1,732 written; re-run writes 0; updated_at untouched). Remaining for Done: prod at the beta.238 release (premigrate, then the backfill dry run and write after deploy; 1,734 writable on prod at merge time, shrinking ~1/30 per day).
<!-- SECTION:DESCRIPTION:END -->
