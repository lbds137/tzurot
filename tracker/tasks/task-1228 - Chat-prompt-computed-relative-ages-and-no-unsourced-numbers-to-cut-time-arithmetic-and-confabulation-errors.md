---
id: TASK-1228
title: >-
  Chat prompt: computed relative ages and no unsourced numbers, to cut
  time-arithmetic and confabulation errors
status: To Do
assignee: []
created_date: '2026-10-13 01:26'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:owner'
dependencies: []
priority: medium
ordinal: 1217000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-1224 eval: of 41 confirmed memory errors in 513 Emily replies, 18 were the model own time or count arithmetic and 17 were confident specifics with no visible source; reasoning hedges were dropped in the reply. Not caused by stored notes.

What: (a) render a computed relative age (3 days ago, this morning) next to each recalled memory and recent message so the model stops subtracting timestamps; check what formatPromptTimestamp already emits; (b) instruction text: no number, clock time, count or you told me without a source in context, otherwise hedge; carry hedges from reasoning into the reply; a stated plan is not a completed event; when notes conflict prefer the newer and say so (overlaps TASK-671 step 0, now live).

Owner question: approve adding these behaviour rules to the character prompt (wording is prompt-taste)?
Recommendation: yes, start with (a) since it is mechanical, then (b) with wording shown first, measured by rerunning the eval after TASK-1225.
<!-- SECTION:DESCRIPTION:END -->
