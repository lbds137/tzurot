---
id: TASK-812
title: >-
  Orchestration spec template omits the format gate, letting a CI failure
  through
status: To Do
assignee: []
created_date: '2026-08-29 04:09'
labels:
  - 'area:skills'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 812000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the verification-gate list in the orchestration skill spec template (item 7) names typecheck, typecheck:spec, lint, and package tests, but NOT a format check. eslint does not enforce line length here, so a 108-char test assertion passed every named gate and would have failed CI format. Caught only because a dispatched orchestrator ran prettier --check on its own initiative beyond the six gates it was given (PR 2248, round 1).

Fix shape: add the format check to the spec template gate enumeration in .claude/skills/tzurot-orchestration/SKILL.md item 7 — npx prettier --check on the touched files, alongside the existing BOTH typecheck AND typecheck:spec note, with the one-line reason that eslint does not cover formatting. Same class as the typecheck:spec note already there: a gate CI runs that a naive package-script list misses.

Acceptance: item 7 of the spec template names the format check with its reason; a dispatch written from the template covers it without the orchestrator having to improvise.
<!-- SECTION:DESCRIPTION:END -->
