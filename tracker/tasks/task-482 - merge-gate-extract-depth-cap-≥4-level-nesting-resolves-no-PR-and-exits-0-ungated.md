---
id: TASK-482
title: >-
  merge gate extract() depth cap ≥4-level nesting resolves no PR and exits 0
  ungated
status: To Do
assignee: []
created_date: '2026-08-09 11:28'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 482000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: pr-merge-review-check.sh's extract() recursion caps at depth > 3, so a gh pr merge nested >= 4 shells deep (bash -c "bash -c \"bash -c \\\"bash -c 'gh pr merge N'\\\"\"") resolves no PR and the gate exits 0 — an UNDER-arm, the dangerous direction, and the only one found in the hooks audit. Reproduced live; 3-level resolves correctly. Requires a deliberately pathological shape nobody types by habit, consistent with the sibling guards' stated habitual-shapes threat model — but the cap is undocumented for the merge gate.
Fix shape (cheap, over-arm direction): when the depth cap is hit AND the remaining token stream still contains the merge tokens, fail toward arming instead of resolving nothing; or at minimum document the cap where the threat model is stated and add a probe case pinning the current 3-level boundary.
Surfaced by post-merge audit of #2009.
<!-- SECTION:DESCRIPTION:END -->
