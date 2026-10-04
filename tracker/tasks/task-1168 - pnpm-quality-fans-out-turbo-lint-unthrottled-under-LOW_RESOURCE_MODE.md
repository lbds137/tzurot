---
id: TASK-1168
title: pnpm quality fans out turbo lint unthrottled under LOW_RESOURCE_MODE
status: To Do
assignee: []
created_date: '2026-10-04 19:29'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1160000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: on 2026-10-04 a main-loop pnpm quality run (LOW_RESOURCE_MODE=1, heap capped) ran turbo lint with default concurrency: 5 eslint processes, ~4.3 GB, machine load 34-38 with 9 sessions open (Deck management relayed the owner report). The quality script starts with `pnpm lint` = `turbo run lint` with no concurrency cap; 05-tooling.md asks for a --concurrency=1 warm-up first, but that depends on memory, and it was skipped.
What: make the quality chain (and `pnpm lint`) honour LOW_RESOURCE_MODE, e.g. a lint:low-mem script used by quality when LOW_RESOURCE_MODE is set, or a turbo concurrency cap read from the env; keep the 05-tooling warm-up advice consistent with whatever ships.
Acceptance: LOW_RESOURCE_MODE=1 pnpm quality runs at most one eslint process at a time (observed with ps during the run); guard:gate-parity still passes.
<!-- SECTION:DESCRIPTION:END -->
