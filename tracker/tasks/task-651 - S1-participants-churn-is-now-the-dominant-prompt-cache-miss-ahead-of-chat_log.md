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

## SECOND CHANNEL + MORE PAIRS 2026-08-18 19:5xZ (folded in from the duplicate TASK-663, now archived)

A later read added channel 1498247824662335608, 12 pairs: 12/12 still cut at
H chat_log, offsets moved from a 14-char band at 27,451-27,465 to a spread of
27,350-97,986, with 9 of 12 above 54,000. That corroborates the "hysteresis
works when S1 holds still" half on a second channel, and the ~3x figure.

Re-read of THIS channel at the same time: 8 pairs, 6/8 at H chat_log spanning
32,326-101,954, and 2/8 still at S1 participants (the same 30,862 / 30,894).
So the S1 divergence is stable across ~19 hours, not a transient.

Two floors observed: two channel-A pairs cut at exactly 27,350, consistent with
count-cap eviction breaking the prefix at the top of chat_log -- the expected
residual, not a failure.

NEW SUSPECT the original filing could not name: TASK-657 slice A added sibling
CHARACTERS to this same roster. A new character speaking now churns the block
too, which did not exist when either read was taken. It does not explain the
observations above (both predate the deploy) but it widens the fix's scope --
whatever stabilises the roster must cover both entity kinds.

CAUTION on the fix-shape list: "bio content" is named there as a candidate
cause. For the HUMAN roster that is `<about>`; there is no character bio in the
roster today, and TASK-660 will add one. Do not read the two as the same thing.

MEASUREMENT CAVEAT, verified 2026-08-18: `cache:prefix-diff` emits NO
cached-token figure, and no other `ops cache:*` command does either (checked via
--help). The "convert before quoting a token or cost number" note above
therefore needs the diagnostic payload's cacheHitRatio, not this command.

Acceptance: the cause of the S1 participants delta between consecutive same-channel generations is identified and named, and either fixed or ruled out with a recorded reason. The cause must be attributed between a genuinely NEW participant (benign, unavoidable, one-time per arrival) and pure window-slide rotation (waste) -- only the second is worth fixing.
<!-- SECTION:DESCRIPTION:END -->
