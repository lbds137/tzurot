---
id: TASK-1437
title: >-
  PR 2759 round-4 nits: structure-only slot-choices docstring and a both +
  wasSet:false clear test
status: To Do
assignee: []
created_date: '2026-11-17T15:24:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1437000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: claude-review round 4 on PR 2759 (no blockers; nits filed past round 3).

(1) packages/common-types/src/constants/ai.ts, CONFIG_SLOT_OPTION_CHOICES docstring: the line saying every slot option today spreads the WITH_BOTH list is a usage claim nothing pins; reword to the structural statement only (it is the base pair WITH_BOTH extends).
(2) services/bot-client/src/commands/preset/override/clear.test.ts: K1 covers slot both with deleted true, but no test covers both with wasSet false (the info branch). Add it so a regression where both stops mapping to all is caught on that branch too.

Acceptance: docstring states structure only; new clear test green and reddens if both maps to text.
<!-- SECTION:DESCRIPTION:END -->
