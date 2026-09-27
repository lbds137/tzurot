---
id: TASK-1118
title: >-
  Drop the machine-wide cadences (memory-prune, usage-audit) once the harness
  cadence ledger ships
status: To Do
assignee: []
created_date: '2026-09-27 10:02'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: medium
ordinal: 1111000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner steer 2026-09-27: management of machine-local memory moves out of Tzurot into the harness. The Harness session agreed and is building a machine-local harness cadence ledger, with an owner role per entry and a `cadence mark <name>` bin, that owns the machine-wide passes: memory-prune (harness:doc-audit's memory pass), usage-audit (it sweeps every project folder), and the always-loaded economy pass for core.md + MEMORY.md. Until it ships, Tzurot's `backlog/cadence-ledger.json` keeps memory-prune, pointed at harness:doc-audit (TASK-1117).

What: once the Harness session reports the version carrying its cadence ledger, remove `memory-prune` and `usage-audit` from `backlog/cadence-ledger.json` and from whatever in Tzurot stamps or reads them (grep `memory-prune` and `usage-audit` across `.claude/`, `packages/tooling/`, `backlog/`, `docs/`). Tzurot keeps its project-scoped cadences (its doc-audit, its economy pass, arch-audit, session-mining for its slug). Check whether the harness session-mining ledger changes what Tzurot's session-mining cadence should track.

Acceptance: no Tzurot session nags about a machine-wide pass; `pnpm ops cadence:status` lists only project-scoped entries; the harness ledger lists memory-prune and usage-audit with an owner role.
<!-- SECTION:DESCRIPTION:END -->
