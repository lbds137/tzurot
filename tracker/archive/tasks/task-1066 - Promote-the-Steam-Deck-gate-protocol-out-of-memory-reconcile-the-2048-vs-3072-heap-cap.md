---
id: TASK-1066
title: >-
  Promote the Steam Deck gate protocol out of memory; reconcile the 2048 vs 3072
  heap cap
status: To Do
assignee: []
created_date: '2026-09-23 23:58'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1060000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: .claude/rules/05-tooling.md § Resource Constraints prescribes "pnpm test && pnpm quality" sequentially, but that sequence has been memory-killed on the Deck, and the working protocol (per-package sequential test loop, lint warm-up, NODE_OPTIONS=--max-old-space-size=3072 for quality, foreground runs, one gate-running unit at a time ACROSS agents) lives only in machine-local Claude memory, which 07-documentation.md says is not a durable layer. The heap cap also disagrees: .husky/pre-push:117 and package.json test:low-mem use 2048, while the memory records 3072 as mandatory for quality (knip OOM). LOW_RESOURCE_MODE is read by both pre-push and root vitest.config.ts (maxWorkers 1 vs 3). Found by a sibling env-cleanup session 2026-09-23; lines verified with git grep the same day.
Fix shape: move the protocol into a durable surface (a short section in 05-tooling.md, or the /tzurot-testing skill, with the machine-specific part in docs/steam-deck/), pick one heap cap and use it in pre-push and test:low-mem, and say plainly which knobs LOW_RESOURCE_MODE turns.
Acceptance: the protocol exists outside memory; one heap-cap value across pre-push, test:low-mem and the documented quality command.
<!-- SECTION:DESCRIPTION:END -->
