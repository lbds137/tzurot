---
id: TASK-1194
title: 'Add surface:inventory --check to the pre-push gate'
status: To Do
assignee: []
created_date: '2026-10-08 21:55'
labels:
  - 'area:ci'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
type: task
ordinal: 1184000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
why: CI caught a stale discord-surface snapshot TWICE in one day (PR 2587, both reds) — the check runs only in CI lint, never in pre-push, so every push touching discord.js-adjacent files can burn a full CI cycle to discover it.
what: add pnpm ops surface:inventory --check to .husky/pre-push (docs/config gate section, next to lines:check), and to the worktree unit gate list in the orchestration skill for units touching bot-client rendering.
acceptance: a stale snapshot fails locally at push time; the orchestration skill names the gate.
Promote when: next push-touch of .husky or the gate list (it is a tooling PR, do with the next one).
<!-- SECTION:DESCRIPTION:END -->
