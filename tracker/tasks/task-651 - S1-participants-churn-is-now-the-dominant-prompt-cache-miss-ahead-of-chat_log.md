---
id: TASK-651
title: 'S1 participants churn is now the dominant prompt-cache miss, ahead of chat_log'
status: To Do
assignee: []
created_date: '2026-08-18 01:57'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 651000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: beta.204 post-deploy prefix-diff on prod channel 1481138179917615144 (5 post-deploy pairs, 2026-08-18 00:01-00:33Z). The count-cap hysteresis WORKS -- when S1 holds still, the cut lands at H chat_log offsets 103,184 and 108,590 (97 percent common prefix), against a pre-deploy baseline of 32,334-32,451 at 29-30 percent. Roughly 3x deeper.

But 2 of the 5 pairs are cut at S1 participants (offsets 30,862 and 30,894, 28-30 percent) -- and they are 19 minutes apart, so this is NOT the one-time prefix warm the release notes predicted for #2129. The participants block genuinely changes between generations, most likely as the speaking roster shifts. That now caps the cache benefit well below what the chat_log-stable pairs demonstrate, which makes S1 the next bottleneck rather than H.

Not yet measured: the cached-TOKEN delta. The cacheHitRatio observability lines were not present in the queried prod window, so only the char-level prefix data is in hand. Convert before quoting a token or cost number.

Fix shape: find what varies in the participants block between consecutive generations in one channel -- roster membership, ordering, bio content, or the #2129 attribution lead-in -- then decide whether the volatile part can move DOWN a stability tier (out of S1 into H or V) the way the design intends. Read prompt-assembly-architecture.md on the S0/S1/H/V tiering before proposing a change.

Acceptance: the cause of the S1 participants delta between consecutive same-channel generations is identified and named, and either fixed or ruled out with a recorded reason.
<!-- SECTION:DESCRIPTION:END -->
