---
id: TASK-475
title: Replace lossy-pipe-guard regex quote-stripping with a shlex tokenizer
status: To Do
assignee: []
created_date: '2026-08-09 03:49'
updated_date: '2026-08-09 06:51'
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


## RULED OUT 2026-08-09 — both remaining arguments fail a direct probe

Decided on merits after re-reading the hook, as the re-scope above asked. The
bug class that motivated filing — six bypasses, every one in hand-rolled quote
handling — was closed by the stateful scanner in #2015, and that scanner is now
shared by all three hooks (#2019). What the re-scope left was two claims. Both
were tested by running shlex over the exact shapes, rather than reasoned about:

1. "A tokenizer fixes the documented unquoted-subshell over-block." It does
   not. `git commit -m $(echo x | head -1) | cat` tokenizes to
   `['git','commit','-m','$','(','echo','x','|','head','-1',')','|','cat']` —
   the inner pipe is still a bare `|` indistinguishable from a real pipeline
   operator. shlex does not track paren nesting. The fix is subshell-depth
   tracking, which can be added to the existing splitter just as easily; none
   of the value comes from the tokenizer.

2. "The awk gap becomes closable once the script is a token." The script does
   become inspectable (`NR<=5` rather than an opaque `S`), but DECIDING it
   requires determining whether an arbitrary awk program truncates — `NR<=5`
   does, `$2 != "pass"` does not, and `{print; if (NR>5) exit}` does. That is a
   parser for awk semantics living in a PreToolUse hook, where a wrong verdict
   either blocks the query this rule RECOMMENDS or misses a truncation. Worse
   than the named gap it replaces.

The probe also surfaced two costs the filing did not know about. `2>&1`
tokenizes to three tokens (`'2'`, `'>&'`, `'1'`), so the REDIRECT_PREFIX
handling — which exists to stop a leading redirect from hiding a filter stage —
would have to be rebuilt against a shattered form. And an unterminated quote
raises ValueError, so the scanner would survive as the fallback anyway: the
rewrite removes nothing.

That leaves uniformity with pr-merge-review-check as the only surviving
argument, which is not a reason to rewrite working code.

Not deferred, not obsolete — ruled out. If the subshell over-block ever becomes
real friction (it fails toward blocking, and is named in the hook header), the
fix is depth tracking in the current splitter, not a tokenizer.

<!-- SECTION:DESCRIPTION:END -->
