---
id: TASK-637
title: 'backlog:digest trend block: open-count deltas and filed-vs-closed rate'
status: To Do
assignee: []
created_date: '2026-08-17 01:33'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 637000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the "backlog is growing, not shrinking" worry recurred 3x across one session window (2026-08-12/13 mining) and outlived a hand-derived data answer, because the number must be re-derived manually each time. A trend surface in the session-start briefing answers it automatically with data.

Fix shape: extend pnpm ops backlog:digest with a trend block - open task count now vs 7 days ago vs 28 days ago, plus filed-vs-closed counts per week. Derive historical counts from git history of tracker/tasks/ (file creation dates in frontmatter + Done/archive transitions in log), no new state. Mining disposition P2 of SYNTHESIS-2026-08-16 (machine-local mined-corpus).

Acceptance: digest prints the trend block with net delta clearly signed; derivation covered by a unit test against a fixture repo state; no gating behavior (digest stays non-gating).
<!-- SECTION:DESCRIPTION:END -->
