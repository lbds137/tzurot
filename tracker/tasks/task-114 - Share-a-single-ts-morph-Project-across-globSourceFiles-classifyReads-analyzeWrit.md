---
id: TASK-114
title: 'Share a single ts-morph Project across globSourceFiles / classifyReads / analyzeWrites'
status: To Do
assignee: []
created_date: '2026-05-21 00:00'
labels:
  - 'area:tooling'
dependencies: []
ordinal: 114000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Share a single `ts-morph` `Project` across `globSourceFiles` / `classifyReads` / `analyzeWrites`

**Why:** `packages/tooling/src/dev/schema-audit.ts` `globSourceFiles()` creates a `new Project(...)` to expand globs into paths; `classifyReads()` and `analyzeWrites()` each construct another `Project` from those same paths. Each pass triggers full ts-morph parsing — three parse passes over the source tree per audit run. **Fix shape**: change `globSourceFiles` to return `{ paths, project }` and thread the project into the two analyzers. ~30 LOC delta. **Why deferred**: tool is documented as one-shot / quarterly; ~3x parse cost is tolerable. Promote if/when runtime becomes a complaint, or if any caller wires the audit into a recurring CI step. Surfaced 2026-05-21 by PR #1076 round-3 claude-bot review. Deferred 2026-05-21.
<!-- SECTION:DESCRIPTION:END -->
