---
id: TASK-399
title: >-
  tzurot-docs Session Start Procedure has drifted from 06-backlog § Starting a
  Session
status: Done
assignee: []
created_date: '2026-08-02 14:03'
updated_date: '2026-08-14 00:17'
labels:
  - 'size:S'
  - 'area:docs'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 399000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the skill carries its own shorter session-start checklist that predates three additions to the canonical list in 06-backlog (backlog:digest, the freshness-check, and the repo-state sweep added by PR #1899). Not a functional gap - 06-backlog is always-loaded so every session gets the real list - but two checklists describing the same moment will keep diverging.
Fix shape: replace the skill-local checklist with a pointer to 06-backlog § Starting a Session (single-sourcing, same move as the test-tier taxonomy), or delete the redundant section outright. Surfaced by claude-review on PR #1899 as pre-existing drift.
<!-- SECTION:DESCRIPTION:END -->
