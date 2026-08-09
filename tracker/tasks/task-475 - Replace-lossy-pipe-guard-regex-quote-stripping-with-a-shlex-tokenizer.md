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

## RE-SCOPED 2026-08-09 — quote handling is already a scanner; what is left is structural

PR 2015 round 9 found the sharpest instance of this class yet: an ordinary
apostrophe in a double-quoted argument paired with one in a later argument,
erasing the pipe between them. `git commit -m "it's" | grep "isn't"` exited 0.

No ordering of the two regex passes fixes that — swap them and a literal double
quote inside single-quoted arguments fails identically — so the strategy needed
STATE, not a reordering.

The quote half of this task is therefore DONE, in 2015. A left-to-right scanner
now tracks which quote is open, treats the other quote character as literal
while inside it, and derives the escape rules from that context (a backslash
escapes inside double quotes and outside them, and means nothing inside single
quotes). It replaced both backslash-neutralization hacks as a side effect. An
unterminated quote strips nothing, matching the strip_heredocs choice to
over-arm rather than risk a bypass.

What remains for a tokenizer is narrower than this task assumed at filing:

- Pipeline structure is still split on a mangled string after quoted spans have
  become placeholders. shlex with punctuation_chars would give real operator
  tokens instead — that is what let the merge gate treat `&&(` as one token
  rather than guessing at it.
- The heredoc pre-pass stays either way; shlex has no concept of heredocs.
- The `awk "NR<=5"` KNOWN GAP may become closable: under a tokenizer the awk
  script is an inspectable token, where today it is an opaque placeholder.

Whether that is worth a rewrite is now a real question rather than an obvious
yes. The scanner closed the bug class that motivated filing this; the remaining
argument is uniformity with pr-merge-review-check plus the awk gap. Decide on
merits, and re-read the hook first — the target has already moved once.

<!-- SECTION:DESCRIPTION:END -->
