---
id: TASK-1115
title: >-
  self-matching-pattern-guard misses a bracketed pattern whose plain literal
  recurs in the same command
status: To Do
assignee: []
created_date: '2026-09-27 08:38'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1108000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: on 2026-09-27 the driver listed probe PIDs with a bracketed `pgrep -f` pattern (which defeats self-match for that token), then in the SAME command line ran an `rm -rf` naming the same path unbracketed. The unbracketed literal matched the shell's own cmdline, so the shell PID landed in the kill list and the kill took down the tool shell (exit 144). The guard passed the command because it only checks whether the pgrep pattern itself is bracketed.

What: in `.claude/hooks/self-matching-pattern-guard.sh`, when a `pgrep -f` / `pkill -f` pattern is bracketed, strip the bracket class to its literal and block if that literal occurs anywhere else in the command text. Add the case to the guard's probe.

Acceptance: the shape above (bracketed pgrep feeding kill, plus the plain literal later in the same command) is blocked with a message naming the second occurrence; a bracketed pgrep with no other occurrence still passes; the probe pins both.
<!-- SECTION:DESCRIPTION:END -->
