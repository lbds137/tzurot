---
id: TASK-1228
title: >-
  Chat prompt: computed relative ages and no unsourced numbers, to cut
  time-arithmetic and confabulation errors
status: To Do
assignee: []
created_date: '2026-10-13 01:26'
updated_date: '2026-10-13 01:55'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Owner ruling 2026-10-12 (AskUserQuestion, backlog review Batch B owner calls): YES: (a) computed relative ages now; (b) the behaviour-rule wording is shown to the owner before it ships.

Premise check 2026-10-12: memory notes ALREADY carry a relative age (formatPromptTimestamp emits 'YYYY-MM-DD (Day) HH:MM • 2 weeks ago' in the historical_note t= attribute, dateFormatting.ts:354). chat_log history uses formatAbsoluteTimestamp on purpose (frozen, cache-stable). So (a) is not 'add ages' for memories; scope it to whether the recent chat turns need a volatile relative-age hint, and whether the coarse relative wording ('2 weeks ago') is what the model mis-subtracts. Measure on the eval data before building.
<!-- SECTION:NOTES:END -->
