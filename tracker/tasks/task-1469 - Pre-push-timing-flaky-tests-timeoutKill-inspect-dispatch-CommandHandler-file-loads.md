---
id: TASK-1469
title: >-
  Pre-push timing-flaky tests: timeoutKill, inspect dispatch, CommandHandler
  file loads
status: To Do
assignee: []
created_date: '2026-11-19T23:59:00Z'
labels:
  - area:ci
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1469000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: three tests failed the pre-push gate under fleet load on 11-19 (PR 2772 pushes 1-2), each in a file the branch did not touch; LOW_RESOURCE_MODE=1 made pushes 3-4 green (recorded there). Re-run-until-green is the current habit; these need a disposition.
What: packages/tooling/src/utils/timeoutKill.test.ts:27 (stdout-on-kill pin, received empty) - note: it pins REAL Node kill behavior, so fake timers would defeat its purpose; the verdict may be declared-load-sensitive with a documented retry path. services/bot-client/src/commands/inspect/index.test.ts dispatch-when-identifier-null (10.2s under load). services/bot-client/src/handlers/CommandHandler.test.ts index-in-subdirectories (5.4s) + skip-non-index (4.6s).
Acceptance: each test gets a recorded verdict - hardened where honest, or declared load-sensitive with LOW_RESOURCE_MODE=1 documented as the retry path - written back on this task; no silent re-run habit.
Promote when: the next pre-push flake on any of the three files.
<!-- SECTION:DESCRIPTION:END -->
