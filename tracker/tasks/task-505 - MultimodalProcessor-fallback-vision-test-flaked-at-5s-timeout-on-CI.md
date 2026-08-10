---
id: TASK-505
title: MultimodalProcessor fallback-vision test flaked at 5s timeout on CI
status: To Do
assignee: []
created_date: '2026-08-10 13:42'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 505000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: unit-tests (ai-worker) went red on PR #2046 (an api-gateway-only diff) — MultimodalProcessor.test.ts "should use fallback vision model when personality has no vision model" failed at 5001ms, the default-timeout shape. Same suite green on the adjacent #2045 run and on local full runs, so it is a flake, not a regression. One observed occurrence; job rerun cleared it (verify on the rerun).
Fix shape: read the test for a real-timer wait on the fallback/retry path (missing fake timers, or a genuine retry delay reaching the runner); pin with vi.useFakeTimers or raise the per-test timeout only if the delay is intrinsic.
Acceptance: the test cannot hit the 5s wall under fake timers; no further CI flakes on untouched-package PRs.
<!-- SECTION:DESCRIPTION:END -->
