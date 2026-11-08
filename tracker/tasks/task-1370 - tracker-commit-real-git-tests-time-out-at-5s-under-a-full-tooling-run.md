---
id: TASK-1370
title: tracker-commit real-git tests time out at 5s under a full tooling run
status: To Do
assignee: []
created_date: '2026-11-08T21:19:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1353000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: during the TASK-314 host gate (2026-11-08) the full `pnpm --filter @tzurot/tooling test -- --maxWorkers=2` failed 3 tests in packages/tooling/src/dev/tracker-commit.test.ts (the real git repository describe: staged git rm, unstaged deletion, subdirectory run) with "Test timed out in 5000ms" at 8-10s each; the file alone passes 34/34. Real-git fixtures exceed the default 5s vitest timeout under suite load, so the gate flakes red.

What: give the real-git describe an explicit per-test timeout sized to measured worst case, or move it to a slower tier.

Acceptance: two consecutive full tooling runs green with no tracker-commit timeouts.
<!-- SECTION:DESCRIPTION:END -->
