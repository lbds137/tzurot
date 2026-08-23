---
id: TASK-698
title: >-
  cache:prefix-diff diffs across interleaved request streams - group pairs by
  personalityId
status: Done
assignee: []
created_date: '2026-08-20 15:03'
updated_date: '2026-08-23 00:56'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 698000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the TASK-670 audit run (prod channel 498827782219104266, 2026-08-20) showed 4 of 5 consecutive pairs cutting at S1 participants offset 27,338 - but the divergence windows revealed an A/B/A/B alternation (roster orderings flip, prompt totals alternate ~160K/~106K, models alternate) = two interleaved request streams from different personalities in one channel. The tool diffs consecutive rows regardless of stream, and a cross-stream pair is not a real cache-miss event: provider prompt caches key per model+stream. The default mixed read therefore OVERSTATES S1 churn, and earlier mixed-channel reads (the 2/5 and 2/8 S1-cut fractions recorded on TASK-651 and in now.md) may carry the same artifact.

What: make the tool stream-aware - group rows by personalityId before pairing (the column exists on llm_diagnostic_logs and the where-clause filter already supports it), print the personalityId per pair, and either skip cross-stream pairs or label them explicitly as cross-stream. Keep --personality as the manual override.

Acceptance: a mixed-traffic channel produces per-stream pair sets with no silent cross-stream comparisons; a test pins that rows from two personalityIds never form a pair unless explicitly requested.
<!-- SECTION:DESCRIPTION:END -->
