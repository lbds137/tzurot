---
id: TASK-1480
title: CPD IMPORT_PATTERN treats dynamic import( and import.meta as module wiring
status: To Do
assignee: []
created_date: '2026-11-20T06:37:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1480000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: packages/tooling/src/cpd/postFilter.ts IMPORT_PATTERN matches any line starting with import, so import(... ) calls and import.meta lines count toward importRatio, and the classifyLine order comment (an import line is module wiring, never control flow) is false for them until fixed.
What: exclude them (negative lookahead on import followed by . or open paren), add a test row each, bump FILTER_IMPL_VERSION and refresh the baseline only if the count moves.
Acceptance: both shapes classify as call; the comment holds.
<!-- SECTION:DESCRIPTION:END -->
