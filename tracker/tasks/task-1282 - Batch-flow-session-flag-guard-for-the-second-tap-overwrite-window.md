---
id: TASK-1282
title: 'Batch flow: session-flag guard for the second-tap overwrite window'
status: To Do
assignee: []
created_date: '2026-10-25 01:07'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 1270000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PR 2652/2653 reviewers (rounds 6-7): the confirm components strip shrinks the double-tap window to the ack+strip round-trips, but a tap Discord delivers inside that window still starts a second flow whose already-gone report replaces the real one. The consequence is documented in multiSelectBatch.ts and both flows pin the strip ordering. If batch reports ever show that overwrite confusion in practice, add a session batchRunInFlight flag (or Redis SET NX keyed on message id) that refuses the second tap.

Promote when: a user report or log pattern shows a second-run overwrite.
Recommendation: leave declined until then - the window is two round-trips and the consequence is cosmetic-per-item.
<!-- SECTION:DESCRIPTION:END -->
