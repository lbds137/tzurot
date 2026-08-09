---
id: TASK-484
title: >-
  pr-merge-review-check PR-number detection is case-sensitive throughout
  (depth-cap regex + top-level regex + bash prefilter)
status: To Do
assignee: []
created_date: '2026-08-09 14:21'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:owner'
dependencies: []
priority: low
ordinal: 484000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the depth-cap fallback regex gh\s+pr\s+merge\s+["']*(\d+) has no (?i), and neither does the top-level python regex nor the bash MERGE_PHRASE_RE prefilter — the whole PR-number detection chain is case-sensitive. Surfaced as a low/informational note on #2024 review round 7 (adjacent to touched code, but pre-existing).
Merits: likely CORRECT-AS-IS — an uppercase GH PR MERGE is not a runnable command (bash command names are case-sensitive), so no case-variant reaches a real merge invocation; unlike develop-code-commit-guard (which added (?i) because a real bypass was found via case), the merge gate identifies which PR a merge targets rather than blocking a dangerous command. Filed for owner awareness because it is security-adjacent; if actioned, it is a whole-file consistency pass (all three sites), not the cap line alone.
Acceptance: owner rules it out on merit, or a single change makes the whole detection chain case-insensitive.
<!-- SECTION:DESCRIPTION:END -->
