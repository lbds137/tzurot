---
id: TASK-331
title: Reminder DM about one week before grace-end
status: To Do
assignee: []
created_date: '2026-07-26 00:00'
updated_date: '2026-09-04 19:39'
labels:
  - 'area:jobs'
  - 'area:api-gateway'
  - 'area:bot-client'
  - 'size:M'
  - 'state:owner'
dependencies: []
priority: low
ordinal: 331000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-26 (retention Phase 3 planning, owner call) — **reminder DM ~1 week before grace-end** (the reachable branch ships single-notice-first: one warning, 30-day grace, purge). Council flagged "a sent DM is not received notice"; a reminder is the strongest available mitigation since Discord has no read receipts, and the owner chose to defer it rather than reject it. **Fix shape**: a `retention_reminded_at` sibling stamp + one more query arm on the notify pipeline + reminder copy — same queue/worker, second pass. **Promote when**: the first grace cycle completes (30d after the first prod notify run) and the outcome argues for a softer path — nobody returned/exported, or a user reports having missed the notice.

**Why:** Single-notice keeps the first cycle's schema and copy minimal; the first real cohort's behavior is the evidence a reminder decision needs.

Owner question: build the one-week reminder DM now that the first prod purge (2026-09-02) removed 5 warned users whose grace expired with no recorded return or export?
Recommendation: build it — that outcome is exactly the shape this task named as its promotion signal, and the mitigation is data-rights adjacent (a sent DM is not received notice).
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:39
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): TRIGGER DATA NOW EXISTS: the first prod purge (2026-09-02) removed 5 users who were warned and let grace expire with no recorded return or export, which is the outcome shape this task named as its promotion signal. Moved to state:owner with the question recorded in the description.
---
<!-- COMMENTS:END -->
