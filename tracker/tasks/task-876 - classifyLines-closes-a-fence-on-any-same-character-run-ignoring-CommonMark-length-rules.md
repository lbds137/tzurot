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

Acceptance: a three-backtick run inside a four-backtick fence classifies as interior rather than closing it; the documented-limitation fixture is rewritten to assert the correct behaviour and the doc-comment clause removed; guard:readme stays green on the real README.
<!-- SECTION:DESCRIPTION:END -->
