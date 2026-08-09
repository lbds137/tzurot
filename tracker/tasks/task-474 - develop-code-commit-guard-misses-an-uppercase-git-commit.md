---
id: TASK-474
title: develop-code-commit-guard misses an uppercase git commit
status: Done
assignee: []
created_date: '2026-08-09 03:32'
updated_date: '2026-08-09 11:12'
labels:
  - 'area:process'
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 474000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Python regex in develop-code-commit-guard.sh is case-sensitive, so `GIT COMMIT -m "x"` is not recognised as a commit and the guard exits 0. Verified by extracting the pattern and running it: matches "git commit -m x", does not match "GIT COMMIT -m x", and carries no inline (?i).

Why it matters: this guard BLOCKS. A missed match means a code commit lands directly on develop or main with no review, which is the exact failure it exists to prevent.

Surfaced by the #2015 review, which found the identical gap in lossy-pipe-guard. That one was fixed there (inline (?i) on both the python patterns AND `shopt -s nocasematch` on the bash pre-filter — fixing only one side fixes nothing, because the pre-filter short-circuits first).

Not ridden into #2015 because this is a different hook: it blocks rather than advises, and a change to its matching deserves its own probe cases. The same reasoning TASK-441 recorded for the same class.

Fix shape: add (?i) INLINE rather than an re.I argument. The agreement test extracts the pattern with `re\.search\(r"(.+)", cmd\)` and hard-fails if that finds zero lines, so an re.I argument outside the string breaks extraction; an inline flag also keeps the flag visible to the agreement comparison. Check the bash pre-check in the same pass.

Acceptance: uppercase and mixed-case git commit / push recognised, probe cases pinning both, agreement test still green.

## SECOND MEMBER 2026-08-09 — the same hook still uses the naive two-pass quote strip

Found by the #2015 round-11 review and CONFIRMED by running it. This is a
BYPASS of a blocking guard, and it is more serious than the uppercase gap above.

develop-code-commit-guard.sh still strips quotes the way lossy-pipe-guard did
before #2015 fixed it: two independent regex passes (every single-quoted span,
then every double-quoted span), pairing raw quote characters with no notion of
which quote type is already open. An ordinary apostrophe inside a double-quoted
argument is read as a real delimiter, and a second one later pairs with it.

Measured, running the hook's own extracted pattern over its own stripping:

    echo "it's" && git commit -m "won't"

strips to `echo S` — the entire `git commit` is erased, detection returns False,
and the guard exits 0. A code commit can then land on develop or main with no
review, which is exactly what this hook exists to prevent.

Note the ordering dependency: a commit whose quoted arguments come AFTER
`git commit` still detects fine (the swallow happens downstream of the match).
It is specifically an earlier quoted argument in the same command — an `echo`
or a chained command carrying a contraction — that hides it.

Fix shape: port the stateful scanner from lossy-pipe-guard.sh (strip_quoted).
It tracks which quote is open, treats the other quote character as literal
inside it, derives the escape rules from that context, and returns the text
unchanged when a quote is unterminated so the failure direction stays
over-arming. Consider extracting it rather than copying — two divergent copies
of quote handling is how this class started.

Do both members in one PR: they touch the same matching path in the same
blocking hook, and each needs probe cases anyway.

Acceptance for this member: the repro above blocks, both orderings pinned
(quoted arg before and after the commit), and the existing 50+ probe assertions
stay green.


## THIRD MEMBER 2026-08-09 — cwd-drift-guard.sh has the same strip

Found by the #2015 round-15 review. `.claude/hooks/cwd-drift-guard.sh` builds
its SCAN with `sed -E "s/'[^']*'//g; s/\"[^\"]*\"//g"` — the same two independent
passes, in sed form, so the same apostrophe pairing applies.

LOWER stakes than the develop-code-commit-guard member, and the difference is
worth keeping straight: cwd-drift-guard only ever ADDS a block, so the failure
mode is a MISSED drift warning, not an unreviewed commit. It does not belong in
the same severity bucket, but it does belong in the same sweep — fixing two of
three copies and leaving the third is how this class survives.

Its comment previously cited lossy-pipe-guard as the precedent for the
technique; that citation is now inverted (lossy-pipe-guard replaced it), and the
site has been annotated to say so.

Extract the scanner rather than making a third copy of it.

<!-- SECTION:DESCRIPTION:END -->
