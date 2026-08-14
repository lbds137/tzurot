---
id: TASK-486
title: >-
  Documented drain query includes Done tasks - 06-backlog claims queries exclude
  Done but task list does not
status: Done
assignee: []
created_date: '2026-08-09 15:31'
updated_date: '2026-08-14 00:17'
labels:
  - 'area:docs'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 486000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: 06-backlog.md states "digest and queries exclude Done" and documents the drain query as pnpm tracker task list -l state:ready -l size:S --priority high --plain - but task list WITHOUT -s "To Do" empirically returns Done rows (verified 2026-08-09: nine Done tasks appeared in an area:tooling listing). The documented drain query therefore over-counts, and a selection query that surfaces closed work wastes the reader on stale rows.
Fix shape: add -s "To Do" to the documented drain query in 06-backlog.md and correct the exclusion parenthetical (digest excludes Done; task list does not). One-line rules edit, review-gated - batch with the next .claude/rules PR.
Acceptance: the drain query as documented returns only open tasks; the exclusion claim matches CLI behavior.
Meta note: assistant-generated process task, filed under an active drain preference - counts against the session net.
<!-- SECTION:DESCRIPTION:END -->
