---
id: TASK-685
title: Re-measure S1 prefix divergence after the guild-info persistence deploy
status: To Do
assignee: []
created_date: '2026-08-19 21:50'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: medium
ordinal: 685000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-651 removed the <guild_info> flicker that cut 2 of 5 prod generations at S1 participants (offsets 30,862 / 30,894). The fix is verified by unit tests including a byte-equality render, but the PROD claim -- that S1 stops being the cut point -- is unverified until measured on real traffic.

What: after the release carrying TASK-651 deploys, run `pnpm ops cache:prefix-diff --show-divergence` on prod channel 1481138179917615144 (the channel both prior reads used, so the numbers are comparable) and compare against the recorded baseline: 2/5 and 2/8 pairs cut at S1, the rest at H chat_log.

Note the first turn after deploy still flickers by construction -- a participant has no stored row until something observes them once. Take the measurement over a window that is not the deploy itself.

Acceptance: a post-deploy pair set is read and the S1-cut fraction is recorded on TASK-651. If S1 is still a cut point, name what else in the block moves.
<!-- SECTION:DESCRIPTION:END -->
