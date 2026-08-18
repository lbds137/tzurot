---
id: TASK-663
title: >-
  Participants roster churns as the fetch window slides, costing an S1 cache
  miss
status: To Do
assignee: []
created_date: '2026-08-18 20:30'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:observable'
dependencies: []
priority: medium
ordinal: 663000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: review finding on PR #2143 plus a matching prod observation the same day. Both rosters -- personas and the sibling characters #2143 added -- derive from the FETCHED history window, which slides forward every turn. Membership can therefore rotate turn to turn on its own, independent of budget selection.

Why this is the expensive kind of miss: the roster sits in the S1 cache prefix, so any change invalidates S1 AND the whole chat_log that follows it, not just the roster bytes.

Prod evidence, 2026-08-18 (the beta.204 post-deploy read, recorded in backlog/now.md): channel 1481138179917615144 had 2 of 8 consecutive pairs diverging at "S1 participants" rather than "H chat_log", at offsets 30,862 and 30,894. The baseline taken the day before had 7 of 8 at chat_log. So this is observed, not projected -- though the cause of those two specific divergences is NOT attributed: a new human simply speaking for the first time also grows the roster, and that is benign and unavoidable.

What #2143 changed: it added a second entity kind to the same roster, so a sibling CHARACTER speaking now churns it too. That did not exist when the baseline was taken. Its own PR body called the block "byte-stable turn to turn", which is true only while the participant SET is stable -- the cost is one-time per roster CHANGE, and #2143 increased how many things change it.

NOT the same as the count-cap hysteresis shipped in beta.204: that stabilized the chat_log EVICTION boundary (TASK-641), a different tier. Whether the roster wants an analogous hysteresis is the open question -- do not assume the existing mechanism covers it.

Fix shape, unscoped on purpose -- measure first: instrument or re-read cache:prefix-diff to find how often an S1-participants divergence is a genuinely NEW participant versus pure window-slide rotation. Only the second is waste. If waste is material, the candidate shapes are a sticky roster (a participant stays for N turns after leaving the window) or a hysteresis mirroring the count-cap one.

Acceptance: the S1-participants divergence rate is measured and attributed (new-participant vs window-slide); either a fix ships or the residual is recorded as accepted with its number.
<!-- SECTION:DESCRIPTION:END -->
