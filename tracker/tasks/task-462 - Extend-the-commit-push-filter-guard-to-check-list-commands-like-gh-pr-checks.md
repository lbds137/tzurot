---
id: TASK-462
title: Extend the commit/push filter guard to check-list commands like gh pr checks
status: To Do
assignee: []
created_date: '2026-08-07 22:30'
updated_date: '2026-08-07 22:30'
labels:
  - 'area:tooling'
  - 'area:process'
  - 'size:M'
  - 'state:owner'
dependencies: []
priority: medium
ordinal: 461000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: git-commit-filter-guard blocks a filtered git commit/push. It does NOT cover gh pr checks, and that is the pipe that caused real damage: gh pr checks 2000 | tail -30 cut a red lint off the TOP of the list, and a failing release PR got reported as green. The SHA-pinned actions/runs query caught it, not the check list.

Same class, same fix shape: a check-list command whose output is truncated hides failures at whichever end gets cut. There is a clean alternative that loses nothing: awk -F tab and select rows where field 2 is not pass.

Fix shape: extend the existing PreToolUse guard (must be BLOCKING — non-blocking PostToolUse output never reaches the agent, confirmed by the TASK-458 probe) to reject a gh pr checks piped into tail/head, naming the awk alternative in the message. Keep GIT_TARGET untouched so the three-way agreement test is unaffected.

Caveat worth weighing before building: piping is legitimate for many commands, so scope this narrowly to check-list commands or it becomes noise. Owner call — a new blocking guard changes every session.

Evidence of recurrence: the agent reached for a filtered git commit/push FOUR times in the 2026-08-07 session and was blocked each time; the one uncovered variant is the one that landed.
<!-- SECTION:DESCRIPTION:END -->
