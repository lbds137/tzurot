---
id: TASK-1405
title: >-
  tracker-commit real-git tests time out at the 5 s default under the pre-push
  fan-out
status: To Do
assignee: []
created_date: '2026-11-11T04:27:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1386000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: packages/tooling/src/dev/tracker-commit.test.ts (describe "trackerCommit — real git repository") runs real git clones per test at ~7-8 s each under load, over vitest default 5000 ms. On 2026-11-10 the PR 2741 pre-push failed three times in a row (2-4 of these tests, "Test timed out in 5000ms"), including with LOW_RESOURCE_MODE=1, while the same file passed alone (34/34, 27.5 s) and CI tooling unit tests passed. The diff being pushed touched no tooling file, so the push was blocked by load, not by the change.
What: give the real-git describe an explicit per-test timeout sized to measured worst case (or reduce per-test git work), and/or have the pre-push tooling suite run with fewer workers.
Acceptance: three consecutive pre-push runs on a loaded Deck do not time out in this file.
<!-- SECTION:DESCRIPTION:END -->
