---
id: TASK-475
title: Replace lossy-pipe-guard regex quote-stripping with a shlex tokenizer
status: To Do
assignee: []
created_date: '2026-08-09 03:49'
updated_date: '2026-08-09 03:49'
labels:
  - 'area:process'
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 475000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Every bypass found in PR 2015 lived in hand-rolled regex quote handling, not in the rule logic. Six of them, in one PR:

- odd backslash count before a closing double quote (swallowed the pipe)
- even backslash run, the mirror of the above, introduced by the fix for it
- backslash before a closing SINGLE quote, the mirror again
- indented heredoc unmatched by the MSG regex
- gh global flags between command and subcommand
- case sensitivity, on both the python regexes and the bash pre-filter

The pattern: a regex cannot model shell quoting, so each fix is correct for the case in front of it and leaves an adjacent one standing. Three of the six were created by an earlier fix in the same PR.

The repo already holds the answer. pr-merge-review-check hit this identical class and PR 2009 replaced its text scan with a Python shlex tokenizer — real quote-awareness, punctuation tokens, no parity arithmetic. Its bug tail ended there. lossy-pipe-guard still strips quotes with `re.sub` and pairs raw quote characters by hand.

Fix shape: tokenize the command with shlex (punctuation_chars=True, posix=True, whitespace_split=True), then do the segment/pipeline split over TOKENS rather than over a mangled string. The heredoc-body strip stays as a pre-pass — shlex has no concept of heredocs — and pr-merge-review-check already carries a tested strip_heredocs to model it on.

Why not ridden into 2015: that PR is at round 8 and is already a strict improvement on what it replaces. A tokenizer rewrite changes how EVERY case is decided, so it needs its own review against the full 60-case probe rather than being bolted on. Ship in bounded units.

Acceptance: the existing probe and unit suites pass unchanged against the tokenizer implementation, plus cases for the shapes regex handling never reached. The known gaps recorded in the hook header get re-evaluated — the awk NR one may become reachable once the script is a token rather than a stripped S.
<!-- SECTION:DESCRIPTION:END -->
