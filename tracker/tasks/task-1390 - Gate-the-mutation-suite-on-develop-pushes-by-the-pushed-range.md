---
id: TASK-1390
title: Gate the mutation suite on develop pushes by the pushed range
status: To Do
assignee: []
created_date: '2026-11-10T14:24:00Z'
labels:
  - area:ci
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1373000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the Mutation-surface gate step is skipped on develop and main (ci.yml:465), so every develop push runs 350-432 s of Stryker vs a 47 s job median on feature branches, even when no tracked package changed. mutation-gate accepts --base (packages/tooling/src/commands/test.ts:35).
What: on develop, run the gate with --base github.event.before; zero or missing before stays fail-open (runs).
Saving: ~300-385 s per develop push touching no tracked package (Fable perf review 2026-11-10, item P5). Complements TASK-674; partly subsumed by the board-commit skip-ci task.
<!-- SECTION:DESCRIPTION:END -->
