---
id: TASK-470
title: 'Assertions that cannot fail: three shapes, three sightings in one session'
status: To Do
assignee: []
created_date: '2026-08-08 17:15'
updated_date: '2026-08-08 23:42'
labels:
  - 'area:process'
  - 'area:tooling'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: medium
ordinal: 470000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A test that passes whether or not the code is correct is worse than no test: it reports coverage while verifying nothing, and it survives review because green is green. Three distinct shapes hit in a single session (2026-08-08), two of which shipped into PRs and were caught by claude-review rather than by authoring:

1. CONDITIONAL ASSERTION. A test with if/else where both arms assert. If the code under test is deterministic, the branch is not defensive — it is an admission the author did not know which behaviour they were pinning. Seen in lines-check.test.ts (scoped-refresh write), fixed by asserting the deterministic branch.

2. ASSERTING ABSENCE BY EXACT-MATCH. expect(x).toEqual([a, b]) implicitly asserts that nothing else appears. When the missing third element is the bug, the test cements it. Seen in health-extras.test.ts: a fixture whose baseline omitted a surface asserted exactly two bullets, locking in the very hole the PR was closing. A SECOND, pre-existing test had the same shape.

3. TOOL-MISSING FALLBACK COLLAPSE. A guard whose before/after values both fall through to the same sentinel when a binary is absent compares sentinel to sentinel and reports PASS. Seen in the pr-merge-review-check probe leak guard (md5sum), fixed by a fatal availability check.

The cheap general defense already in use and worth naming: MUTATE AND CONFIRM RED. Before trusting a new assertion, break the code it covers and watch it fail. Used four times this session and it caught every one of these; it also caught four mutants that silently did not apply (perl interpolates $VAR inside \Q..\E), which would otherwise have read as coverage.

Why filed rather than done: the natural home is a clause in 02-code-standards Testing Standards, which is an ALWAYS-LOADED surface. doc-61 (context-economy pass) names the exact conflict of interest — the agent proposing rule additions should not be sole judge of what earns that space, and the July trim headroom is already being spent. So this needs weighing against the economy pass rather than a unilateral append.

Acceptance: either a short clause lands in 02-code-standards (owner sees the diff), or the pattern is folded into the doc-61 pass as content that earns its place, or it is ruled out on merit with the reason recorded.

DISPOSITION (owner, 2026-08-08): the second option. Weighed inside the next context-economy pass rather than appended beside it. Only the one-line defense is a candidate for always-loaded space — mutate the code an assertion covers and confirm it goes red — because that is a constraint a reader acts on. The three shapes above are examples of what it catches, and examples are what an always-loaded surface can least afford; they stay here. State is dependent on the doc-61 pass running, not owner.

DISPOSITION (TASK-490 rider): INCLUDED — one-line mutate-and-confirm-red clause added to 02-code-standards Testing Standards.
<!-- SECTION:DESCRIPTION:END -->
