---
id: TASK-795
title: >-
  board-gate probe: pin the separator variants of the over-authorization and
  mistaken-bypass shapes
status: Done
assignee: []
created_date: '2026-08-28 16:53'
updated_date: '2026-09-03 15:01'
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

CLOSED PARTIAL, shipped as PR 2318 (91060fa75). Four cases added, probe 43 to 47. What is NOT covered, and why it is not a follow-up: acceptance clause 1 is met only on the PASSING arm (a compound where every commit carries the prefix, pinned for semicolon, ampersand and pipe). The BLOCKING arm - a bypass-free commit beside a bypassed one - is not parameterized, because no mutation distinguishes it. Those arms reach their verdict through the count comparison at board-commit-branch-gate.sh:212, which never inspects the separator; the separator appears only in the bypass anchor at :204. Narrowing that anchor leaves every blocking variant green, and the only mutation that reddens them (dropping the -eq clause) reddens the pre-existing double-ampersand cases in the same run. So the nine candidate cases are redundant rather than vacuous, and clause 3 of this same acceptance line - every case has a demonstrated failing mutation - is what rules them out. This is a measured negative result, not deferred work, and it now lives in the probe beside the loop it explains (grep for NOT parameterized, deliberately). Two neighbouring spellings are likewise documented rather than pinned: export VAR=1 double-ampersand git commit really would export the variable, so pinning its refusal would freeze behaviour that may want changing; and the space-free VAR=1 double-ampersand git commit cannot be reddened under any mutation that changes only separator handling.
<!-- SECTION:DESCRIPTION:END -->
