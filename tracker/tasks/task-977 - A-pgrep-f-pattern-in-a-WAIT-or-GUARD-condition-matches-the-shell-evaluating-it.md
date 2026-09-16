---
id: TASK-977
title: >-
  A pgrep -f pattern in a WAIT or GUARD condition matches the shell evaluating
  it
status: Done
assignee: []
created_date: '2026-09-14 15:19'
updated_date: '2026-09-16 15:27'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 973000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: on 2026-09-14 a background watcher ran 18.6 hours without exiting because its wait condition used pgrep -f with a pattern string that its own command line contained. pgrep matched the watcher PID itself, kill -0 on that PID always succeeded, and the negated guard never became true; the real build had exited long before. 00-critical covers pgrep -f for KILL commands but not for WAIT or GUARD conditions, which is the same self-match with a different consequence: waiting on yourself forever instead of killing yourself. Fix shape: one clause in an always-loaded surface saying a pgrep -f pattern inside a wait or guard condition matches the shell evaluating it, and to match on something the command line cannot contain (a pidfile, a marker file, an exact match on the binary) or to capture the PID before the loop starts. Acceptance: the clause names the wait-condition case, not only the kill case.

Closed by .claude/hooks/self-matching-pattern-guard.sh, a PreToolUse Bash hook that blocks any pgrep -f / pkill -f whose pattern is not the bracket form, covering the WAIT and GUARD cases as well as the kill case.
<!-- SECTION:DESCRIPTION:END -->
