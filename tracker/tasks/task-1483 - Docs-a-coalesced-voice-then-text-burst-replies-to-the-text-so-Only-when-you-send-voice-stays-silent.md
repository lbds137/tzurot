---
id: TASK-1483
title: >-
  Docs: a coalesced voice-then-text burst replies to the text, so "Only when you
  send voice" stays silent
status: Done
assignee: []
created_date: '2026-11-20T13:36:00Z'
updated_date: '2026-11-22T04:53:00Z'
labels:
  - area:docs
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1483000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: beta.247 release review (PR 2774). Under coalescing (PR 2769) the survivor is the newest trigger, so a burst of voice then text gets one reply decided by the text message: no voice reply under the "Only when you send voice" mode of /voice replies (PR 2773). Consistent with latest-wins, but surprising.
What: one line in docs/commands.md or the getting-started guide near the voice-replies row.
Acceptance: the user-facing docs state the burst behavior.
<!-- SECTION:DESCRIPTION:END -->
