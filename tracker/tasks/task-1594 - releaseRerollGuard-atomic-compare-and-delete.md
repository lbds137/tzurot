---
id: TASK-1594
title: 'releaseRerollGuard: atomic compare-and-delete'
status: To Do
assignee: []
created_date: '2026-11-28T19:49:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1584000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: review on #2834 (nit 7). releaseRerollGuard in bot-client rerollGuard.ts is read-then-delete, so a guard re-acquired between the read and the delete is released by the wrong holder (the header already says so).
What: replace it with a compare-and-delete, either a small Lua EVAL or an equivalent atomic. Note that 03-database.md discourages reflexive Lua, so justify it as lock correctness, not a counter.
Acceptance: release deletes only when the stored value matches, with a test.
<!-- SECTION:DESCRIPTION:END -->
