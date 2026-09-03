---
id: TASK-873
title: >-
  ContextWindowManager hysteresis test has thin timeout headroom and flakes
  under parallel test load
status: To Do
assignee: []
created_date: '2026-09-03 02:03'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 873000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the HYSTERESIS / HEAD STABILITY test in services/ai-worker/src/services/context/ContextWindowManager.test.ts timed out at the 5000ms vitest default during a full pnpm test run while turbo ran 26 concurrent tasks. Run alone the file passes in 3.22s total and that single test takes 1583ms, so headroom to the default timeout is roughly 3x. The same file passed inside an isolated worktree full-suite run on the same commit, so this is CPU contention on the Steam Deck rather than a regression. Found while gating the TASK-871 extraction; unrelated to that diff.

Fix shape: profile why this one test costs 1583ms when the other 32 in the file total well under a second - it builds 60 entries and measures each to derive a budget. Prefer shrinking the fixture while keeping the hysteresis property pinned. Falling back to an explicit per-test timeout is acceptable only with a comment naming the measured solo runtime, since a raised timeout hides the cost rather than removing it.

Acceptance: the test completes with comfortable margin under the default timeout with the head-stability property still asserted, or carries an explicit timeout justified by a measured number in a comment.
<!-- SECTION:DESCRIPTION:END -->
