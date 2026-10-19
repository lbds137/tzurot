---
id: TASK-1244
title: >-
  Measure whether skill-eval SKILL CHECK reminders cause skill loads the
  description alone would not
status: Done
assignee: []
created_date: '2026-10-18 12:57'
updated_date: '2026-10-19 02:28'
labels:
  - 'area:hooks'
  - 'state:ready'
  - 'size:S'
dependencies: []
priority: low
ordinal: 1232000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Seyag will take .claude/hooks/skill-eval.sh (UserPromptSubmit keyword reminders) only with a number showing it changes behavior; the hook header claims skill auto-activation succeeds ~20% of the time without it, which is unverified.

What: with seyag session-log or session-extract over the Tzurot session logs, count user prompts where skill-eval fired a SKILL CHECK, and for each whether the named skill was loaded later in the same turn; compare with prompts that matched no keyword but whose turn loaded a skill anyway, and with sessions before the hook existed if any remain. Report the lift (loads following a reminder that the description alone did not produce) with the counts, send the number to Seyag, and record it here.

Acceptance: a measured lift with its counts; the hook moves to Seyag or stays here on that number.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Measured 2026-10-18 over 85 top-level Tzurot transcripts (2026-09-18..10-18), script docs/local/task-1244/skill-lift.mjs (positive-controlled: 8/8 task-notification turns flagged on the measuring session).
- Human prompts 573 (418 typed + 155 queued); 183 (32%) carried a reminder.
- Of 222 (human turn, named skill) pairs not already loaded in the transcript, 11 (5%) loaded the skill that turn; 61 more pairs named an already-loaded skill.
- 2,690 of 3,064 task-notification turns (88%) and 114 of 227 peer messages (50%) also got a reminder: ~94% of reminder-bearing turns are not human prompts.
- All turns: 4,874 reminded pairs, 79 loads (1.6%); of 148 skill loads, 79 followed a reminder naming the skill, 69 had none.
- No counterfactual: hook added 2026-02-03, oldest kept transcript 2026-09-18. 11 is an upper bound on reminder-caused loads; the header's ~20% claim stays unverified.
Outcome: Seyag ruled the move out on these numbers (2026-10-18). Keep-in-Tzurot and the noise fix: TASK-1251.
<!-- SECTION:NOTES:END -->
