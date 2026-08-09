---
id: TASK-441
title: >-
  Backport commit-tree exclusion to python-side git-commit guards (+ hook nits
  from #1980 review)
status: Done
assignee: []
created_date: '2026-08-05 20:32'
updated_date: '2026-08-07 23:57'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 441000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: #1980 fixed \bcommit\b matching plumbing subcommands (commit-tree/commit-graph) in lib/git-command.sh, but develop-code-commit-guard.sh (~line 79) and git-commit-filter-guard.sh (~line 64) still use the bare \bcommit\b Python regex. develop-code-commit-guard BLOCKS, so a legitimate git commit-tree on develop with dirty review-gated files would be wrongly blocked. Raised by the #1980 round-5 review; not folded in because changing a blocking hook deserves its own probe-covered PR.

Members (same touch, fold in): (a) the backport itself - trailing ([^-a-zA-Z0-9_]|$) equivalent in both Python regexes + probe cases; (b) move the two jq forks in claim-shape-guard.sh / fixup-rider-check.sh behind a raw substring pre-check on $INPUT so the cheap-first comment is accurate; (c) show the session-mining mid-turn jq snippet inside its for-loop context (standalone snippet references loop-scoped $f/$CORPUS); (d) consider reusing develop-code-commit-guard heredoc/quote stripping in is_git_commit_command to kill message-text false-fires.

STATUS after #1981: (a), (b) and (c) SHIPPED. (d) remains — the task stays open for it. #1981 deferred (d) because it needs a runtime-confirmed false-fire first, and the bash-vs-Python tradeoff is real: bash cannot express the heredoc delimiter backreference, so the options are a bash state loop or forking Python from the lib.

(e) NEW, from the #1981 round-3 review: the raw-stdin pre-check landed only in claim-shape-guard.sh and fixup-rider-check.sh, but develop-code-commit-guard.sh and git-commit-filter-guard.sh are the PreToolUse hooks that run on EVERY Bash call, and they still fork jq twice before their decoded-command short-circuit. That is where a cheap-first pass actually pays. Not ridden in #1981 because an early exit added to a BLOCKING guard is a behavior change needing its own probe cases. See also TASK-442 (the three-way regex sync guard).

Acceptance: git commit-tree not treated as git commit by any hook (probe-pinned in both guards); claim-shape/fixup-rider hooks fork jq only when the input plausibly contains a commit.

## MEASUREMENT 2026-08-07 — (e) is worth doing

Timed 50 runs of develop-code-commit-guard.sh against a non-git payload
(`ls -la`), on the Steam Deck:

- full hook: 1.108s / 50 = **22.2ms per Bash call**
- the two bare jq forks alone: 0.814s / 50 = **16.3ms per Bash call**

So jq is ~73% of the hook's cost, paid on EVERY Bash call, twice over across
the two blocking hooks. The existing `case` short-circuit runs after the jq
forks — it saves the python spawn, not the jq spawns.

Safety argument for the raw-$INPUT pre-check (the reason #1981 deferred it):
it is **fail-open by construction**. JSON escaping only inserts backslashes at
`"`, `\`, and control chars, and no standard encoder escapes ASCII letters — so
any decoded command containing `git`…`commit` implies the raw payload contains
`git`…`commit`. The raw check is therefore strictly WEAKER than the decoded one
(it can over-match, never under-match), and over-matching just does today's
work. Probe cases should pin: a normal payload still reaches the guard, and the
canonical heredoc commit form is not skipped.

(d) remains parked pending a runtime-confirmed false-fire, per the original
entry — do not build it on a code-read mechanism.

## STATUS after #1999 — (e) SHIPPED; only (d) remains

(e) landed: both PreToolUse guards now pre-check the RAW stdin before forking
jq. Measured 100 runs each on a non-git payload: develop-code-commit-guard
22.25ms -> 9.07ms, git-commit-filter-guard 22.35ms -> 9.02ms (both fire on
every Bash call, so ~26ms returned per call). The 50 existing probe assertions
were the regression evidence — every verdict unchanged — plus 5 new boundary
cases and a canary (over-tightening the pre-check fails 18 assertions).

The safety concern that deferred it out of #1981 is closed: the raw check can
only OVER-match, and that was runtime-verified against a REAL harness payload
(a live `git push ... | tail` blocked through the pre-check path), not just
jq-built fixtures.

Review note worth keeping: #1999's reviewer suggested the same win applies to
claim-shape-guard.sh and fixup-rider-check.sh. It does NOT — verified, they
already carry the raw pre-check ahead of their jq forks (member (b), shipped
in #1981). Do not re-file it.

REMAINING: (d) only. Reuse the heredoc/quote stripping inside
is_git_commit_command to kill message-text false-fires. Still gated on a
runtime-confirmed false-fire — do not build it on a code-read mechanism. The
bash-vs-Python tradeoff is unchanged: bash cannot express the heredoc delimiter
backreference, so the options are a bash state loop or forking Python from the
lib.

## CLOSED 2026-08-07 — (d) is moot, so nothing remains

TASK-458's remediation re-homed claim-shape-guard to .husky/pre-commit (it now
reads the staged diff) and fixup-rider-check to .husky/commit-msg (it now reads
the commit-message subject). Neither does command-text matching anymore, so
both stopped sourcing lib/git-command.sh — leaving `is_git_commit_command` with
ZERO consumers, verified by grep: the only remaining mentions are the
definition itself, two comments in the Python guards, and the agreement test.

That moots (d) twice over:

1. There is no false-fire left to kill. (d) wanted heredoc/quote stripping to
   stop a commit whose MESSAGE mentions `git commit` from firing the guard, but
   the two hooks that consumed the function are gone from that path. The two
   Python guards already do their own stripping and were never the target.
2. Doing it would BREAK something. The function survives as the reference copy
   that gitCommitPatternAgreement.test.ts compares the two live Python regexes
   against. Hardening only the bash copy makes it diverge from both, which is
   exactly the drift that test exists to fail on.

With (a)/(b)/(c) shipped in #1981 and (e) in #1999, every member is now shipped
or moot. Closing.

If a message-text false-fire is ever observed in one of the PYTHON guards, that
is a new task against those regexes — not a revival of this one, whose target
was the bash lib.

Note 2026-08-08: fixup-rider-check.sh has been deleted (TASK-472 — the rider
class is delegated to review). Every reference to it above is history: its
members are shipped, and the acceptance line naming it is satisfied by its
removal rather than by anything left to do.

Note 2026-08-08 (second): lib/git-command.sh and is_git_commit_command are gone
too (TASK-466). This does not reopen (d) — it closes it harder — but it DOES
invalidate the stated reason. The CLOSED section above gives two reasons (d) is
moot, and reason 2 ("the function survives as the reference copy the agreement
test compares against") is now false: nothing survives, and the agreement test
runs on the two blocking Python copies alone. Reason 1 still stands on its own,
and (d) is now unreachable rather than merely unnecessary — there is no bash
function left to harden. Recorded because a reader who checks reason 2, finds
it false, and stops there could conclude (d) is live again.

<!-- SECTION:DESCRIPTION:END -->
