---
id: TASK-1243
title: 'Dedupe gh:ci-gate onto Seyag pr-ci-wait and retire the Tzurot copy'
status: To Do
assignee: []
created_date: '2026-10-18 12:57'
labels:
  - 'area:hooks'
  - 'state:ready'
  - 'size:M'
dependencies: []
priority: medium
ordinal: 1231000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Seyag ruled (2026-10-18) that pnpm ops gh:ci-gate duplicates its pr-ci-wait bin, so the move is a Tzurot-side retirement, not a port. Two waiters drift independently.

What: diff the two feature by feature first (gh:ci-gate prints CI_COMPLETE / CI_GATE_TIMEOUT / CI_GATE_STARTUP_FAILURE / CI_GATE_REVIEW_MISSING, waits for the Claude Code Review run, refuses a non-head --sha, and counts review rounds with the REVIEW_ROUND_CAP line). Anything pr-ci-wait lacks goes upstream to Seyag before the switch. Then point the Monitor command at pr-ci-wait in its three pinned copies (05-tooling.md, the pr-monitor-reminder hook heredoc, tzurot-git-workflow), update guard:monitor-command, and delete gh:ci-gate and its tests and docs row.

Acceptance: one CI waiter; the sentinel vocabulary the rules name still prints; guard:monitor-command green.
<!-- SECTION:DESCRIPTION:END -->
