---
id: TASK-1139
title: >-
  Nested dispatch contract: the inner worker never runs a heavy gate while the
  orchestrator does
status: To Do
assignee: []
created_date: '2026-09-27 22:38'
labels:
  - 'area:skills'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1131000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: 2026-09-27 the TASK-1133 nested unit (Opus orchestrator + Sonnet worker in one worktree) ran two eslint src processes at once, ~1.7 GB each, and pushed the Deck to swap 8.2/8.2 GB with 676 MB available (Deck management report; 11 sessions live). The dispatch prompt forbade repo-wide pnpm test but did not say who runs gates, so both layers linted concurrently. 05-tooling.md Resource Constraints says one gate-running unit at a time but does not name the intra-unit case.

What: add one contract point to .claude/skills/tzurot-orchestration/SKILL.md § Nested dispatch (the non-negotiable list): the inner worker runs at most the single fast check its edit needs (one test file) and NEVER lint, typecheck, quality or a package suite; the orchestrator runs every heavy gate, one at a time, after the worker has returned. Mirror it in the spec template's gates item.

Acceptance: the contract bullet exists; the next nested dispatch prompt carries it.
<!-- SECTION:DESCRIPTION:END -->
