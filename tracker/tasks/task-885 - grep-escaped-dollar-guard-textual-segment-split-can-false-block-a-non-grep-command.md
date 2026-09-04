---
id: TASK-885
title: >-
  grep-escaped-dollar-guard: textual segment split can false-block a non-grep
  command
status: To Do
assignee: []
created_date: '2026-09-04 09:06'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 883000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the hook splits a Bash command into segments on the pipe, semicolon, and-and, or-or, and newline tokens as text, without shell parsing, so those characters INSIDE a quoted string fragment the segment where the shell would not. In every shape the probe exercises the cost is a miss (a chained non-grep segment is left alone, probe case 15), but a fragment that happens to begin with a grep word, carries no -F, and contains the failing double-quoted backslash-dollar shape blocks even though the text was never a grep command. Constructed example: echo "run: cat f | grep \"\$x\" later" fragments at the pipe into a piece starting with grep. Disclosed in the hook header comment; a review of PR 2322 asked for it to be tracked rather than only commented.

Fix shape: none until observed. A real false block reads as the hook banner on a command with no grep in it. Closing it needs real shell parsing of quotes before splitting, which the hook deliberately does not do; the bypass TZUROT_ALLOW_GREP_DOLLAR=1 is the workaround at the moment it happens. If it recurs more than once, consider walking quotes before the split using the same alternation the eaten-pattern check already uses.

Promote when: the hook blocks a command that contains no grep invocation.
<!-- SECTION:DESCRIPTION:END -->
