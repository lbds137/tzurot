---
id: TASK-266
title: "withPolicyArm's ?? 0 fallback poisons partially-ranking arms"
status: To Do
assignee: []
created_date: '2026-07-14 00:00'
labels: []
dependencies: []
ordinal: 266000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`withPolicyArm`'s `?? 0` fallback poisons partially-ranking arms — `factPoolScoring.withPolicyArm` assigns rank 0 when `policyRanks` misses a candidate — never triggers today (policyRanks ranks everything; the #1643 review called it harmless), but `poolScoring.rankedIds` treats 0 as a REAL rank that sorts FIRST, so any future arm that ranks a subset (e.g. a collapse/filter arm) silently puts its DROPPED candidates at the top of the ordering (bit a collapse-gate sim: recall@5 read 0.013 until diagnosed). **Fix shape**: fallback to `null` (the documented "not surfaced" value) + loosen `FactPooledCandidate.ranks` to `number | null`; or make `rankedIds` skip non-positive ranks. **Promote when**: next eval-scoring touch. Surfaced 2026-07-14 (slice-B offline gate).

**Why:** A defensive default that actively lies is worse than a throw.
<!-- SECTION:DESCRIPTION:END -->
