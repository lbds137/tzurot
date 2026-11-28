---
id: TASK-1593
title: 'Reroll commit: re-check hasNewerRow under the row lock'
status: To Do
assignee: []
created_date: '2026-11-28T19:49:00Z'
labels:
  - area:api-gateway
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1583000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: review on #2834 (nit 3). historyReroll.ts runs the hasNewerRow check before commitReroll takes the row lock, so a user message persisted in between is missed and the reroll lands over a turn already answering the old text.
What: re-run the predicate inside the commit transaction after lockHistoryRow, or comment the window.
Acceptance: the predicate runs under the lock, with a test; or the window is documented at the call site.
<!-- SECTION:DESCRIPTION:END -->
