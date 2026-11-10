---
id: TASK-1388
title: Run hook probes through a small parallel pool
status: To Do
assignee: []
created_date: '2026-11-10T14:23:00Z'
labels:
  - area:tooling
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1371000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: guard:hook-probes runs 17 probes sequentially (packages/tooling/src/dev/check-hook-probes.ts:309 loop, :220 execFileSync); the CI step is 88 s median on the lint critical path, and the same command runs in every pnpm quality.
What: async pool of 3-4; verify each probe isolates its temp state (mktemp) first.
Saving (estimate): 40-55 s per CI run and per local quality run (Fable perf review 2026-11-10, item P3).
Acceptance: same pass/fail output; measured step time before/after in the PR.
<!-- SECTION:DESCRIPTION:END -->
