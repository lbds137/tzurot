---
id: TASK-795
title: >-
  board-gate probe: pin the separator variants of the over-authorization and
  mistaken-bypass shapes
status: To Do
assignee: []
created_date: '2026-08-28 16:53'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 795000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: two test-coverage suggestions from the final review round on PR 2242, filed rather than opening an eleventh round on a PR whose reviewer found no correctness issue. Both are shapes the reviewer hand-traced and found correct; neither is a known defect. The value is regression protection, not a fix.

1. Every over-authorization case (a bypass on one commit must not waive a bypass-free commit beside it, including the three-commit chain with the ungated one in the middle) uses the double-ampersand separator. The same logic holds for semicolon and pipe compounds by construction — the value class excludes all three separators identically — but nothing pins it, so a future change to separator handling could break those paths with no test turning red.

2. The shape TZUROT_ALLOW_BOARD_ON_FEATURE=1 followed by double-ampersand and then git commit is a plausible MISTAKEN attempt at the bypass (using a compound operator where the documented form is a bare prefix). It is correctly refused today by the value-class and whitespace requirements, and it IS named in KNOWN GAPS, but it has no probe case of its own — unlike the separator-terminated shapes, which do.

Fix shape: extend the existing assert_cmd cases in board-commit-branch-gate.probe.sh — parameterize the over-authorization cases over the three separators the way the separator-terminated-assignment cases already loop, and add the compound-operator attempt as its own case. Canary each addition by reverting the relevant value-class exclusion and confirming the new cases redden; if one cannot be made to redden, do not ship it as coverage — say so in a comment instead, which is the precedent set in that file for two hardenings that have no failing fixture.

Acceptance: the over-authorization property is pinned for all three separators, the compound-operator attempt has a case, and every added case has a demonstrated failing mutation.
<!-- SECTION:DESCRIPTION:END -->
