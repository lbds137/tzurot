---
id: TASK-1150
title: >-
  Orchestration spec template: name the repo-level structure/colocation gate for
  units creating new files
status: To Do
assignee: []
created_date: '2026-10-01 03:30'
labels:
  - 'area:skills'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1142000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the M4 app-id-filter unit (PR #2560) created utils/interactionFamilies.ts; its gates (bot-client suite + pnpm quality) passed locally and the claude-review approved, but CI failed on the repo-level structure test (tests/ or root structure.test.ts) requiring a colocated .test.ts for every new source file - a gate no per-package command runs, exactly the blind spot tzurot-orchestration item 7 warns about for repo-level gates. Cost: one CI round-trip (2026-10-01 03:23Z run 36810176708).

What: add one line to the tzurot-orchestration SKILL.md item 7 (Verification gates): a unit creating any NEW source file also gates on the repo-level structure/colocation test before push, since CI runs it in the unit-tests job regardless of the touched packages own suite. .claude/skills edits require a PR - ride it on the next skills-touching PR or batch with the next Seyag adoption pass.

Acceptance: the line exists in the skill; the next new-file unit names the structure gate in its spec.
<!-- SECTION:DESCRIPTION:END -->
