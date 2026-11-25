---
id: TASK-1548
title: 'Correct the vi.mock ledger row: a missing factory key throws, not undefined'
status: To Do
assignee: []
created_date: '2026-11-25T18:03:00Z'
labels:
  - area:skills
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1544000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the third Premise-ledger row in .claude/skills/tzurot-orchestration/SKILL.md (spec template item 1, PR #2812) says a missing factory key leaves the new export undefined. vitest 4.1.12 throws instead: node_modules vitest/dist/chunks/startVitestModuleRunner.*.js:327 raises [vitest] No "X" export is defined on the "<path>" mock. Did you forget to return it from "vi.mock"? A worker who hits that message should recognise it as this row.

What: (1) reword the symptom to the throw message; (2) in the importOriginal/vi.importActual bullet, give the stale-override reason for renames only (on a removal the key is dead fixture); (3) re-flow the 84-column first line of the block. Same edit, one file, protected path (visible subagent).

Acceptance: the skill names the throw message; a one-line vitest probe (factory omitting a key, test reads it) shows the throw; lines:check green.
<!-- SECTION:DESCRIPTION:END -->
