---
id: TASK-464
title: claim-shape-guard cannot-<verb> pattern false-fires on ordinary prose
status: To Do
assignee: []
created_date: '2026-08-07 23:50'
updated_date: '2026-08-07 23:50'
labels:
  - 'area:process'
  - 'area:tooling'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: medium
ordinal: 463000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Surfaced 2026-08-07 on the very first commit after the guard moved to .husky/pre-commit (TASK-458). Its output is now actually READ, so its noise level became observable for the first time - previously it printed into a void via PostToolUse.

Two hits on that commit, both false positives:
1. .husky/pre-commit - the comment describing what the guard looks for. FIXED in the same PR by adding .husky/ to the path exclusions, symmetric with .claude/.
2. gitCommitPatternAgreement.test.ts - "Those two cannot be collapsed into one". The cannot(be|happen|match|occur) alternative matches ordinary English about CODE STRUCTURE, not a runtime claim about what a field holds. Not fixed - narrowing detection is a behaviour change that needs its own probe cases.

The cannot-be arm is the loose one: "cannot be collapsed/extracted/reused/tested" are all design prose. The other arms (always populated, never null, guaranteed to) are much more specifically runtime-claim shaped.

Fix shape: either drop the bare `be` alternative, or require a following runtime-ish token (null/empty/undefined/set/present/reached). Add probe cases pinning both directions - "cannot be collapsed into one" silent, "cannot be null here" fires.

Acceptance: one full working session of commits with no false fire, or the arm is narrowed and probe-pinned.
<!-- SECTION:DESCRIPTION:END -->
