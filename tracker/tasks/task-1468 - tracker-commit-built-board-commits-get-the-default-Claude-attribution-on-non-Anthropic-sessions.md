---
id: TASK-1468
title: >-
  tracker:commit-built board commits get the default Claude attribution on
  non-Anthropic sessions
status: To Do
assignee: []
created_date: '2026-11-19T21:44:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1468000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: tracker:commit builds a subject-only message, so the commit-msg hook appends the harness-default Co-Authored-By — on this GLM/z.ai session that misattributes the work. Observed: 1ef2c83d5, fa6666c12, 052118b24 all carry `Co-Authored-By: Claude <noreply@anthropic.com>` (checked via git log --format=%(trailers)); my heredoc commits in the same window carry the correct GLM trailer.

What: tracker:commit gains the driving session attribution (a --trailer flag, or it composes the trailer itself from env the commit-msg hook honors), so a board commit from a non-Anthropic session ends with that session trailer.

Acceptance: a tracker:commit run from a GLM session produces a commit whose trailers name GLM-5.3-Flash (z.ai) via Claude Code, verified with git interpret-trailers.
<!-- SECTION:DESCRIPTION:END -->
