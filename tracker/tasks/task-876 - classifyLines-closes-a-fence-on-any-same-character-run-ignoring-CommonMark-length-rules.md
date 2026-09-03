---
id: TASK-876
title: >-
  classifyLines closes a fence on any same-character run, ignoring CommonMark
  length rules
status: To Do
assignee: []
created_date: '2026-09-03 11:38'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 876000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: packages/tooling/src/dev/check-readme-classes.ts classifyLines closes a fence with match?.[1].startsWith(fenceChar), which compares the delimiter CHARACTER only. CommonMark requires a closing fence to be at least as long as its opener, so a three-backtick run currently closes a four-backtick fence where the spec keeps it as interior text. Pre-existing - the code this replaced did the same with a bare startsWith on three backticks - and surfaced by claude-review round 2 on PR 2315.

No live impact today: the real README.md has zero tilde fences and zero four-plus-backtick fences, verified by grep. The limitation is documented in the classifyLines doc comment and pinned by the test titled "documented limitation: a shorter closing run still closes a longer fence", so it is visible rather than a trap - which is why it was documented rather than fixed in that PR.

Fix shape: measured during the round-2 work and recorded here rather than lost. Store the whole opening run instead of its first character - fenceChar = match[1] in place of fenceChar = match[1][0] - and the equal-or-greater-length rule falls out of the existing startsWith comparison. Every other fence test stayed green under that mutation; the only fixture needing an update is the documented-limitation one, which would flip to asserting the CommonMark-correct interior classification.

SECOND DIVERGENCE, same closing branch, folded in from claude-review round 3 on PR 2315: a closing delimiter carrying TRAILING CONTENT still closes the fence. CommonMark allows only trailing whitespace on a closer - an info string is permitted on the opener alone - so a line like three backticks followed by prose should stay interior text, and here it ends the fence. The closing branch matches on FENCE_DELIMITER, which anchors on the leading run and ignores whatever follows, so the two divergences share one code path and should be fixed in one pass rather than separately.

Round 3 also asked whether tag on a closing delimiter line reflects the OPENING fence info-string rather than the closer own trailing text. It does, and correctly: the closing branch pushes the carried tag and never recomputes it - read from origin/fix/task-872-readme-guard-residue. That half is correct by design and is NOT part of this task; it is recorded so the next reader does not re-derive it. What is untested is the pairing of the two - a closer with trailing content, asserting the carried tag - which falls out of the fixture this task needs anyway.

Acceptance: a three-backtick run inside a four-backtick fence classifies as interior rather than closing it; a closing delimiter with trailing content likewise stays interior; the documented-limitation fixture is rewritten to assert the correct behaviour and the doc-comment clause removed; guard:readme stays green on the real README.
<!-- SECTION:DESCRIPTION:END -->
