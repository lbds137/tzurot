---
id: TASK-1442
title: 'Command-tree audit: consistency, ergonomics and discoverability (Fable)'
status: To Do
assignee: []
created_date: '2026-11-17T20:29:00Z'
labels:
  - area:bot-client
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1442000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Lila 11-17 — users struggle to find settings. Two kinds of per-user override exist (user-tier settings via /settings defaults, and the preset override) and their split is not obvious. She had to walk a user through turning character voice back on for one character after the global voice default changed to reply-to-voice-only (a cost decision for the self-hosted voice engine).

What: a Fable 5.2 audit of the command tree (docs/commands.md and services/bot-client/src/commands) for naming consistency, ergonomics and discoverability, with concrete recommendations. Findings land in docs/local and are turned into tasks.

Addendum (Lila 11-17): reorganizing which settings sit on which page is in scope; for settings that are user-overridable, the UX patterns (grouping, order, labels, landing view) should match the admin dashboard as closely as possible — admin has more entries only because not everything is overridable.

Round 1 report: docs/local/command-tree-audit.md (gitignored). Round 2 (page-by-page comparison vs admin) pending.

Acceptance: the findings report exists, every recommendation has a disposition, and the user-facing calls go to Lila.
<!-- SECTION:DESCRIPTION:END -->
