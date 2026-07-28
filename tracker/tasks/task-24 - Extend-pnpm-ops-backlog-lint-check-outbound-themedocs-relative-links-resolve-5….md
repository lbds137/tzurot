---
id: TASK-24
title: 'backlog lint: verify outbound theme-to-docs relative links resolve'
status: To Do
assignee: []
created_date: '2026-07-03 00:00'
updated_date: '2026-07-28 11:28'
labels:
  - 'area:tooling'
  - 'size:S'
dependencies: []
priority: low
ordinal: 24000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Surfaced 2026-07-03 — Extend `pnpm ops backlog` lint: check outbound relative links in `tracker/docs/` doc bodies resolve (5 wrong-depth dead links found in the 2026-07-03 sweep of the then-theme files; the migration depth-rewrote them, but nothing gates future rot — the lint only checks queue.md doc references today).

**Why:** Dead links in theme/idea docs silently rot navigation.
<!-- SECTION:DESCRIPTION:END -->
