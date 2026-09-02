---
id: TASK-862
title: >-
  lossy-pipe-guard false positive: quoted prose inside a heredoc that merely
  describes a blocked command shape is blocked
status: To Do
assignee: []
created_date: '2026-09-02 03:15'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 862000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: found during the 2026-09-02 session-mining run, then reproduced live while filing this task: the first filing attempt was blocked because its description quoted the documented example (a gh checks read piped into tail with a line count) as prose inside a single-quoted heredoc. lossy-pipe-guard.sh scans the whole Bash command text, so any heredoc body or quoted string (a tracker description, a PR body, a mining README entry) that mentions the shape trips the guard although no gh or git command is being piped.

Fix shape: strip heredoc bodies (from the <<TAG marker to the terminating TAG line) and quoted-string contents before matching the pipe patterns, reusing the executed_segments/strip_quoted machinery in .claude/hooks/shell_quotes.py that cwd-drift-guard already uses, rather than adding a second quote parser. Probe fixtures: the documented example written as prose inside a heredoc must PASS; the same text as a real command must still BLOCK; every existing fixture stays green.

Acceptance: both new probe fixtures green; guard:hook-probes green.
<!-- SECTION:DESCRIPTION:END -->
