---
id: TASK-1462
title: >-
  Stop hold-cycle creation and job submission during shutdown; unref deadline
  timers
status: To Do
assignee: []
created_date: '2026-11-19T06:40:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1462000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-66 PR 2769 round-7 #4. Two shutdown races: a hold whose saveUserMessage resolves during or after beginShutdown takes the step-4 immediate-submit path, which never checks shuttingDown and submits a new job while the bot is stopping; and entries created that late arm 10-minute deadline timers that are not unref()d. Fix: unref() the deadline timer, and give the registry a closed flag set by clear() that makes submitOrHoldSlot stop creating cycles or submitting after shutdown. Acceptance: a trigger arriving during shutdown neither submits nor arms a live timer; timers unref their handles.
<!-- SECTION:DESCRIPTION:END -->
