---
id: TASK-1048
title: >-
  develop-code-commit-guard misses a commit inside bash -c or an unquoted
  heredoc body
status: To Do
assignee: []
created_date: '2026-09-22 19:39'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1042000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the TASK-1045 adversarial pass (2026-09-22) measured two bypasses of develop-code-commit-guard that predate that PR, identical with the old and new shell_quotes helper. (1) A plain `bash -c 'git commit -m x'` passes the guard (exit 0). (2) An unquoted-marker heredoc body whose `$( )` runs a commit passes it (exit 0); strip_heredoc_bodies removes the body before any scan, but bash executes substitutions in an unquoted body. Also unprobed: shell-invoking tools with no shell word (watch, su -c, ssh host) around a single-quoted command.
Fix shape: unwrap -c / eval arguments and scan them as commands, the way board-commit-branch-gate already unwraps bash -c, sh -c and eval to depth three (commit 6e868e627); scan unquoted-marker heredoc bodies for substitutions instead of stripping them. Add probe rows for each, and decide watch/su/ssh coverage explicitly.
Acceptance: probe rows for bash -c, sh -c, eval, and an unquoted heredoc body with a commit substitution all block on develop; the harness in TASK-1045 PR body shows those rows at exit 2.
<!-- SECTION:DESCRIPTION:END -->
