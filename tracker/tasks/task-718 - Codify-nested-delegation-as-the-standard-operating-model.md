---
id: TASK-718
title: Codify nested delegation as the standard operating model
status: To Do
assignee: []
created_date: '2026-08-21 20:39'
labels:
  - 'area:skills'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: medium
ordinal: 718000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner decision (2026-08-21) — if the TASK-667 nested-delegation pilot succeeds, tiered delegation (Fable main loop dispatches an Opus orchestrator agent that spawns Sonnet workers and returns an uncommitted diff; Fable reviews, commits, and owns the PR cycle) becomes the STANDARD operating model when Fable drives, replacing manual model-switching between sessions. Opus-driving sessions keep the existing /tzurot-orchestration posture unchanged.

What: update .claude/skills/tzurot-orchestration/SKILL.md mode-decision table with the nested posture for the Fable-driver row: dispatch shape (worktree isolation, base-SHA self-heal step 0, no-commit contract, five-gate verification, report requirements), the review gate staying with the Fable main loop, and the pilot evidence. Review-gated PR (skills are load-bearing).

Acceptance: the skill documents the nested posture with its dispatch template; the pilot outcome (defect rate at the Fable review gate, Fable-side token overhead) is recorded as the evidence basis; gated on pilot success — if the pilot fails, archive this task with the failure analysis instead.
<!-- SECTION:DESCRIPTION:END -->
