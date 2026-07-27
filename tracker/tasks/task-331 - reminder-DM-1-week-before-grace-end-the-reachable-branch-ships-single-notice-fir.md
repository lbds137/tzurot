---
id: TASK-331
title: 'reminder DM ~1 week before grace-end (the reachable branch ships single-notice-first: one…'
status: To Do
assignee: []
created_date: '2026-07-26 00:00'
labels:
  - 'area:jobs'
dependencies: []
ordinal: 331000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-26 (retention Phase 3 planning, owner call) — **reminder DM ~1 week before grace-end** (the reachable branch ships single-notice-first: one warning, 30-day grace, purge). Council flagged "a sent DM is not received notice"; a reminder is the strongest available mitigation since Discord has no read receipts, and the owner chose to defer it rather than reject it. **Fix shape**: a `retention_reminded_at` sibling stamp + one more query arm on the notify pipeline + reminder copy — same queue/worker, second pass. **Promote when**: the first grace cycle completes (30d after the first prod notify run) and the outcome argues for a softer path — nobody returned/exported, or a user reports having missed the notice.

**Why:** Single-notice keeps the first cycle's schema and copy minimal; the first real cohort's behavior is the evidence a reminder decision needs.
<!-- SECTION:DESCRIPTION:END -->
