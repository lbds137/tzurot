---
id: TASK-1465
title: >-
  Tracker CLI fuzzy search crashes on some queries (Bun TypeError in bundled
  backlog-bin)
status: To Do
assignee: []
created_date: '2026-11-19T13:02:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1465000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Observed 2026-11-18: two consecutive task list --search invocations crashed with TypeError: Error is not a constructor (evaluating new t[0]) at /$bunfs/root/backlog-bin:291:25086, after first dumping a large binary blob into the output. The two crashing queries were unquoted single-word terms; earlier searches the same day succeeded. Repro 2026-11-19: --search "cache" --plain ran clean (exit 0), so the trigger is query-dependent and unpinned; suspect the bundled CLI chokes while reading specific match content.

Why: fuzzy search is the backlog discovery path; the crash cost a cycle twice in one session and the blob dump pollutes the transcript.

Acceptance: reproduce against the tracker CLI source (the bundle built from packages/tooling), add a regression test for the crashing query shape, and make the CLI fail with a clean error instead of a blob dump. If a structured sweep of query shapes cannot reproduce, record that here and close as not-reproducible.
<!-- SECTION:DESCRIPTION:END -->
