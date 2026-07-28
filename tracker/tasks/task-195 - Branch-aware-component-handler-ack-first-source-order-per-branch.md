---
id: TASK-195
title: Branch-aware component-handler-ack-first (source-order → per-branch)
status: To Do
assignee: []
created_date: '2026-06-30 00:00'
updated_date: '2026-07-28 10:50'
labels:
  - 'area:tooling'
  - 'size:M'
dependencies: []
priority: low
ordinal: 195000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Branch-aware `component-handler-ack-first` (source-order → per-branch)

**Why:** The rule tracks `sawRealAsync` function-scoped + source-order, not per-branch. So a dispatch function where an EARLIER branch does real-async-before-its-own-ack forces a fresh `eslint-disable` on every LATER branch's ack (`dashboardActions.ts` `handleAction`: 3/4 branches suppressed; `purge.ts` `handlePurgeModal`: 2). As more `actionId` branches get added to these dispatchers, the suppression count grows rather than the rule catching new violations "for free." **Fix shape**: make the rule reset/scope `sawRealAsync` at branch boundaries (if/switch-case), so a sibling branch's async doesn't leak — likely needs ESLint's code-path analysis (`onCodePathStart`/`onCodePathSegmentStart`) rather than the current single-pass walk. **Promote when**: the suppression count in these dispatchers grows, or a new dispatch handler hits the same pattern. Surfaced 2026-06-30 by PR #1409 review (design observation, non-blocking).
<!-- SECTION:DESCRIPTION:END -->
