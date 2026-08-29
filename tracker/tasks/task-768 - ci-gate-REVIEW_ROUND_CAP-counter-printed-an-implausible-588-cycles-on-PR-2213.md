---
id: TASK-768
title: ci-gate REVIEW_ROUND_CAP counter printed an implausible 588 cycles on PR 2213
status: Done
assignee: []
created_date: '2026-08-24 20:45'
updated_date: '2026-08-29 21:07'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 768000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the 2026-08-24 ci-gate monitor notification for PR #2213 printed "REVIEW_ROUND_CAP: 588 claude-review cycles ... at the ~6-round cap" — implausible for a same-day feature PR, so the counter is measuring something other than review cycles on some path (known inflation case in 05-tooling.md covers workflow-sync PRs, but 588 exceeds any push-churn explanation).
Fix shape: read the cycle-count derivation in packages/tooling/src/gh/ci-gate.ts (verify path by grep), find the query/filter that can overcount (likely counting all check runs or all bot comments rather than distinct review cycles), add a regression test pinning the count on a fixture with N review rounds + M unrelated runs.
Acceptance: counter reports plausible round counts; test covers the overcount shape observed on #2213.
<!-- SECTION:DESCRIPTION:END -->
