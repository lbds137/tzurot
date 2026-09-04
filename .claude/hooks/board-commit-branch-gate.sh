#!/bin/bash
# PreToolUse hook: block a BOARD/DOC-ONLY `git commit` on a feature branch.
#
# Tracker/backlog/CURRENT/docs commits belong on `develop` (the direct-commit
# allowlist in 00-critical.md § Direct doc commits). Made on a feature branch,
# they strand: the follow-up `git push origin develop` no-ops as "Everything
# up-to-date" in silence, and the task/board state is invisible to every query
# until someone notices and cherry-picks. Recovered three times in one epoch,
# each inside a dispatch window with the main tree parked on a feature branch.
# The sibling gates cannot see this class: develop-code-commit-guard exits
# early on any non-develop/main branch, and tracker-dirty-push-gate fires at
# push (too late) on dirtiness (wrong condition).
#
# Blocks ONLY when BOTH hold:
#   (a) current branch is not develop / main / release-shaped, and
#   (b) the files this commit would capture are non-empty and ALL inside the
#       board/doc allowlist (the PATH half of 00-critical.md's table —
#       its >300-line-docs PR carve-out stays judgment, not hook-enforced)
#       — a mixed or code-bearing commit is ordinary
#       feature work and passes untouched.
#
# Legit exception (a doc that belongs WITH the feature PR): bypass once with
#   TZUROT_ALLOW_BOARD_ON_FEATURE=1 git commit ...
#
# Fail-open on everything else: not a Bash tool call, no git commit in the
# command, not a repo, any git error. A broken gate must not block commits.
#
# WRAPPER UNWRAPPING: a `bash -c "…"` / `sh -c "…"` / `eval "…"` wrapper hands
# its string argument to a shell as a command bash actually runs, so the scan
# unwraps each wrapper invocation and assesses its inner string as a command in
# its own right — recursively, to a nesting depth of three
# (`MAX_WRAPPER_DEPTH` in lib/shell_quotes.py). Deeper nesting is left as the
# placeholder text the quote strip produced for it, an under-arm at a nesting
# depth no habitual command shape reaches.
#
# KNOWN GAPS, named rather than hidden. They fail in OPPOSITE directions, and
# that is deliberate: a missed DETECTION lets a commit through, while a missed
# BYPASS only refuses an escape hatch. Each half fails toward the harmless
# outcome for what it governs. None is a habitual shape here.
#
# Detection gaps — degrade to the gate not firing (a silent pass):
#   - bundled short flags (`-qa`, `-aq`) defeat the literal `-a`/`-am`/`--all`
#     auto-stage detection. Only the auto-stage widening is missed; the commit
#     itself is still detected, so the staged set is still assessed.
#   - a porcelain rename under -a/--all reads as one non-board token (below).
#   - `chore/release-*` matches ANY branch with that prefix, not only real
#     release-cut branches — accepted wideness, same fail-open direction.
#   - a wrapper nested FOUR or more levels deep is not unwrapped (WRAPPER
#     UNWRAPPING above stops at three), so a compound inside it is never
#     assessed and passes — accepted, no habitual shape nests that deep (probe
#     case: "a fourth wrapper level is left as a placeholder and passes").
#   - a pathspec whose quoted value contains a NEWLINE splits the line-oriented
#     pathspec field into two bogus tokens and passes — accepted, not a
#     habitual shape.
#   - a pathspec whose resolved value starts with a DASH (`git add "-x.md"`)
#     is dropped by the flag skip below, quoted or not — git itself needs a
#     `--` before such a path, and no board filename starts with one.
#   - a command carrying a LITERAL placeholder codepoint (U+E000 / U+E001)
#     anywhere makes `strip_quoted_indexed` refuse the scan outright, so the
#     gate assesses the RAW text: an add pathspec's quote characters are then
#     part of its token, the token misses the board allowlist, and a board-only
#     commit passes. Deliberate — refusing is what stops a stray codepoint
#     shifting the resolved value of every LATER pathspec, and the fallback is
#     the same fail-open direction the unterminated-quote case already takes
#     (probe case: "a literal placeholder codepoint falls back to the raw text
#     and passes"). Ordinary command text never contains these codepoints.
#
# Deliberate OVER-arming — the opposite direction, and therefore listed apart
# from the gaps rather than among them. The shared commit pattern's `\b` left
# context arms on a dash-prefixed wrapper name (`my-git commit`), and its `(?i)`
# arms on `GIT COMMIT`. Arming only means the branch and allowlist checks get
# to run, and against a CODE-bearing, mixed, or empty file set that still
# passes — the widened side of the pattern cannot wrongly block a real code
# commit. The narrow exception, not a counterexample to that: an unrelated
# `-git`-suffixed command (`my-git commit -m msg`, not git at all) CAN be
# blocked, based on whatever happens to be staged at that moment — runtime-
# confirmed (probe case: "a dash-prefixed wrapper name arms detection").
#
# Bypass-recognition gaps — degrade to the gate BLOCKING, which is the safe
# direction for an escape hatch (the worst case is a refused bypass, never a
# granted one):
#   - the bypass is recognised only as a bare `VAR=1 git commit` prefix, so
#     `export TZUROT_ALLOW_BOARD_ON_FEATURE=1 && git commit ...` — which really
#     would export it — is refused. The documented form is the bare prefix.
#   - a BARE newline between the assignment and the commit correctly blocks:
#     bash treats a bare `\n` as a real command separator (the assignment does
#     NOT carry over), and the junction excludes `\n` on purpose for exactly
#     that reason (see BYPASS_RE below). A backslash-continued prefix
#     (assignment ending `\` then a real newline, commit on the next physical
#     line) is NOT in this list — it is not a gap at all: `strip_quoted`
#     collapses the continuation before BYPASS_RE ever runs (see its comment
#     below), so the scanned view sees one unbroken logical line and the
#     bypass is granted, matching bash's own line-continuation semantics.
#     Runtime-confirmed.
#   - likewise a subshell-wrapped prefix (`(VAR=1 git commit ...)`), whose `(`
#     is neither start-of-line nor a command separator, and an operator-adjacent
#     prefix with no spaces (`VAR=1&&git commit`), where the value class stops
#     AT the `&` and the whitespace the pattern then requires is not there.
#   - a real, legitimately-prefixed commit sitting BESIDE an UNRELATED
#     newline-split `git`⏎`commit` pair (no valid executing command — see
#     BYPASS_RE's own comment on its embedded COMMIT_RE copy) inflates the
#     outer commit COUNT by one more than it inflates the bypass count, so
#     the count comparison spuriously refuses a bypass that was carried. A
#     deliberate, narrower BLOCK than "no phantom present" would give — the
#     safe direction, never a false grant.
#   - a bypass prefix on the WRAPPER itself (`TZUROT_ALLOW_BOARD_ON_FEATURE=1
#     bash -c "git commit …"`) really would export the variable into the inner
#     shell, but the gate refuses it: the outer text carries the assignment
#     and no commit, the inner text carries the commit and no prefix, so the
#     bypassed count lands below the commit count and the comparison blocks.
#     The documented form is the prefix on the `git commit` itself. Pinned by
#     a probe case.
# The threat model is the habitual mis-commit shape (plain `git add tracker/
# && git commit`, 3 observed incidents) — exotic spellings are not written by
# accident, mirroring lossy-pipe-guard's stated boundary.

set -uo pipefail

INPUT=$(cat 2>/dev/null) || exit 0
COMMAND=$(printf '%s' "$INPUT" | jq -r '
  select(.tool_name == "Bash") | .tool_input.command // empty' 2>/dev/null) || exit 0
[ -z "$COMMAND" ] && exit 0

# Cheap raw short-circuit before spawning python: no git+commit tokens at all.
# `nocasematch` because the detection pattern below is case-insensitive — a
# case-SENSITIVE short-circuit here would exit before `GIT COMMIT` ever reached
# it, silently undoing that half of the pattern (probe case: "uppercase GIT
# COMMIT still blocks").
shopt -s nocasematch
case "$COMMAND" in
  *git*commit*) ;;
  *) exit 0 ;;
esac
shopt -u nocasematch

# Strip heredoc/substitution message bodies, then quoted spans, so a commit
# MESSAGE containing "git commit", " -a ", "--all", or "git add" cannot
# trigger (or suppress) any detection below. Quote stripping MUST be the
# shared single-scan `strip_quoted` (lib/shell_quotes.py, same as the three
# sibling hooks): two independent sed passes pair apostrophes ACROSS quote
# types — `echo "it's" && git commit -m "won't"` erased the whole
# `git commit` between the contractions, a measured silent bypass of the
# sibling gate. A python failure falls through to exit 0 (fail-open); the
# probe, not runtime, catches a missing lib.
HOOK_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
SCAN=$(GUARD_CMD="$COMMAND" HOOK_LIB="$HOOK_LIB" PYTHONDONTWRITEBYTECODE=1 python3 << 'PYEOF2'
import os
import re
import sys

sys.path.insert(0, os.environ["HOOK_LIB"])
from shell_quotes import (
    strip_quoted_indexed,
    resolve_placeholders,
    wrapped_command_strings,
    QUOTED_SPAN,
    MAX_WRAPPER_DEPTH,
)

cmd = os.environ.get("GUARD_CMD", "")

# What counts as a commit invocation, defined ONCE — and spelled identically to
# the copies in `develop-code-commit-guard.sh` and `lossy-pipe-guard.sh`. All
# three are held to one shared case table by
# packages/tooling/src/dev/gitCommitPatternAgreement.test.ts, which EXTRACTS
# this exact line out of this file by its `COMMIT_RE = re.compile(r"…")`
# spelling and hard-fails if it stops matching exactly one line. Keep it on one
# line; do not reformat it across two.
COMMIT_RE = re.compile(r"(?i)\bgit(?:\s+-+[^-\s]\S*(?:\s+[^-\s]\S*)?)*\s+commit(?![-\w])")
# The `git add` sibling of the same shape. No other hook detects `git add`, so
# it has no cross-hook copy and is not in that agreement table; it is written
# in the same spelling so the two read as one decision.
ADD_RE = re.compile(r"(?i)\bgit(?:\s+-+[^-\s]\S*(?:\s+[^-\s]\S*)?)*\s+add(?![-\w])")
# Auto-stage flags, matched only INSIDE a commit invocation's own argument span
# (`segment_after`). Scanned over the whole command instead, `git branch -a &&
# git commit -m x` read as an auto-staging commit and pulled every dirty
# tracked file into the assessed set — and one unrelated dirty non-board file
# there turns a board-only commit into a silent pass.
AUTOSTAGE_RE = re.compile(r"\s(?:-am|-a|--all)(?=\s|$)")
# Other env assignments may precede ours. This value class excludes only
# whitespace, unlike the bypass token's own value below, and that asymmetry is
# deliberate rather than an oversight: no input was found where letting a
# GENERIC assignment's value swallow a separator grants a bypass bash would
# not, because the token's own match still has to land in prefix position
# afterwards. Tightening it here was tried and reverted — no probe case could
# distinguish the two forms, and an unfalsifiable tightening is
# indistinguishable from no tightening.
#
# The JUNCTION after each assignment's value is `[ \t]+`, not `\s+`: a `\n` is
# a command separator in bash, so an assignment on one line does NOT carry
# into a command on the next. `\s+` matched across it anyway (\s includes
# \n), reading `TZUROT_ALLOW_BOARD_ON_FEATURE=1\ngit commit` as one prefixed
# invocation — a false GRANT, runtime-confirmed (probe case: "newline-joined
# assignment does not carry into the commit"). This class is used twice —
# once for a leading generic assignment, once trailing our own token before
# COMMIT_RE — and both had the same bug, since it is one definition reused.
ASSIGNMENTS = r"(?:[A-Za-z_][A-Za-z0-9_]*=\S*[ \t]+)*"
# The bypass match must span the assignment ALL THE WAY THROUGH to a
# `git ... commit` token, because that is what an env-assignment prefix means in
# a shell: it governs the one command it precedes. Two weaker anchors were tried
# and both let the token authorize a commit it has nothing to do with —
# accepting it after any whitespace let an UNQUOTED single-token message
# (`git commit -m TZUROT_ALLOW_BOARD_ON_FEATURE=1`, no quoted span for
# strip_quoted to collapse) disable the gate from inside its own message, and
# accepting it merely at segment start let an INERT trailing segment
# (`git commit -m msg; TZUROT_ALLOW_BOARD_ON_FEATURE=1`) do the same — an
# ordinary shell shape, not an exotic one. Probe cases pin all four shapes.
#
# `re.M` keeps `^` anchored per LINE, which is what the line-oriented scan this
# replaced did, so a bypass prefix opening line 2 of a multi-line command is
# still recognised.
#
# The commit half is wrapped in a SCOPED `(?i:…)` rather than folded into a
# whole-pattern `re.I`: shell variable names are case-SENSITIVE, so a
# case-insensitive `tzurot_allow_board_on_feature=1` would be a false GRANT —
# the one direction this check must never fail in. The inline `(?i)` has to come
# off first because Python rejects a global flag that is not at position 0.
#
# The bypass token's own VALUE stops at a control operator as well as at
# whitespace. `;`, `&` and `|` end a word with or without surrounding space, so
# `TZUROT_ALLOW_BOARD_ON_FEATURE=1; git commit` is an unexported assignment
# followed by a SEPARATE command that never sees the variable. A value class
# excluding only whitespace swallows the separator and reads the whole thing as
# one prefixed invocation — a false GRANT again (probe cases: "an assignment
# terminated by <sep> does not carry into the commit").
#
# The JUNCTION right after that value is `[ \t]+`, matching ASSIGNMENTS' own
# fix above and for the identical reason: `\s+` crossed a `\n`, so an
# assignment opening line 1 reached a `git commit` opening line 2 even though
# bash treats the newline as a command boundary between them — a false GRANT,
# runtime-confirmed (probe case: "newline-joined assignment + commit").
#
# The leading `(?:^|[;&|])\s*` keeps `\s*`, deliberately NOT narrowed: it sits
# BEFORE the assignment, consuming only whitespace that already follows a real
# separator (`^` or `;`/`&`/`|`) — the separator itself is what draws the
# command boundary here, so whitespace including a newline after it is just
# ordinary formatting (`;\nTZUROT_ALLOW...=1 git commit` is the same shell
# statement as `; TZUROT_ALLOW...=1 git commit`). Narrowing this one would not
# close a grant; it would only reject a harmless formatting variant.
#
# The embedded copy of COMMIT_RE below (required verbatim by
# gitCommitPatternAgreement.test.ts, so its OWN `\s+` between `git` and
# `commit` is not touched here) is not a false-GRANT vector: despite also
# crossing newlines (bash treats a bare `\n` as a command terminator, so
# `git` and `commit` split across one are two SEPARATE commands — `git` with
# no subcommand, then a bare `commit`, never a real executing `git commit`),
# this copy only counts toward `bypassed` when a bypass assignment precedes
# it, so a phantom match here can never grant an unearned bypass on its own.
#
# It IS a false-BLOCK vector, and the inflation is NOT symmetric with
# COMMIT_RE's own outer use as `commits`: the outer count grows on the
# phantom match alone, with no precondition, while this copy only grows
# `bypassed` when that same phantom also sits behind a bypass assignment. A
# real prefixed commit sitting BESIDE an unrelated newline-split `git`/
# `commit` pair therefore inflates `commits` by one more than it inflates
# `bypassed` — COMMIT_COUNT=2 vs BYPASSED_COUNT=1 — and the
# bypassed/commit-count comparison this gate is built on spuriously BLOCKS a
# bypass that was legitimately carried. Runtime-confirmed (probe case:
# "phantom newline-split commit beside a real prefixed commit still
# blocks"). This is a bypass-recognition gap in the fail-safe direction
# named above — a refused bypass, never a granted one — and is deliberately
# not being fixed here: doing so would mean relaxing the count comparison,
# which would also let a genuinely unbypassed commit ride through on a
# phantom's coattails, the wrong direction for an escape hatch.
# Guards the slice below: if a future edit ever changes COMMIT_RE's inline
# flags, this raises loudly and immediately, right here — instead of the
# slice silently mis-embedding a wrong prefix (or re.compile throwing deep
# inside a `SCAN=$(...) || exit 0` that swallows any python failure, which
# would degrade to the WHOLE gate going fail-open on every invocation with no
# indication beyond a mass probe failure). An `if`/`raise` rather than a bare
# `assert`: an `assert` is compiled out entirely under `-O`/`PYTHONOPTIMIZE`,
# and a guard against a silent fail-open must not itself be conditionally
# absent — the one interpreter mode where the check would matter most is
# exactly the one where `assert` disappears.
if not COMMIT_RE.pattern.startswith("(?i)"):
    raise SystemExit("COMMIT_RE no longer opens with the literal 4-char (?i) the slice below assumes")
BYPASS_RE = re.compile(
    r"(?:^|[;&|])\s*"
    + ASSIGNMENTS
    + r"TZUROT_ALLOW_BOARD_ON_FEATURE=[^\s;&|]+[ \t]+"
    + ASSIGNMENTS
    # Sliced rather than `.removeprefix("(?i)")` — that method is Python
    # 3.9+, an undocumented floor this file otherwise doesn't take (contrast
    # develop-code-commit-guard.sh and lossy-pipe-guard.sh, which each name
    # their own Python-version requirement explicitly). `COMMIT_RE.pattern`
    # always starts with the literal 4-char `(?i)` this file itself wrote
    # two definitions above, so the fixed-length slice is exact for this
    # input; it is not a general prefix-strip.
    + "(?i:" + COMMIT_RE.pattern[len("(?i)"):] + ")",
    re.M,
)


def scan(text, depth):
    # Applied to the HEREDOC-STRIPPED `text`, not the original: a heredoc body
    # is inert data, so a wrapper written inside one is not a command bash
    # runs, and stripping first keeps it from being unwrapped below. At depth
    # 0 this leaves the view identical to what the scan produced before this
    # function existed, so the existing verdicts are untouched.
    text = re.sub(r"\$\(cat <<'?\"?(\w+)'?\"?.*?\n\1\s*\)", "MSG", text, flags=re.S)
    text = re.sub(r"<<[-~]?\s*'?\"?(\w+)'?\"?.*?\n\1(?=\s|$)", "HEREDOC", text, flags=re.S)
    # strip_quoted_indexed returns None on an UNTERMINATED quote (and on `$'...'`
    # with an escaped \', which its single-quote branch cannot know is not a
    # terminator; and on a command already carrying a literal QUOTED_SPAN or
    # ESCAPED_BLANK codepoint, which would otherwise shift the value index of
    # every add pathspec after it). Scanning the literal text "None" matched no
    # `git ... commit`, so the commit count came back 0 and the WHOLE gate went
    # silently inert on any such command — runtime-confirmed against the
    # canonical blocking fixture. Fall back to the raw command, which is what
    # the module's docstring tells callers to do and what all three sibling hooks
    # already did. Over-arming is the recoverable direction here: blocking still
    # requires every captured file to be a board file, so a code commit passes
    # regardless (probe case: "an unterminated quote does not disarm the gate").
    #
    # But the raw text is exactly what the bypass check must NOT run against — its
    # whole safety argument is that quoted spans are gone, so a commit MESSAGE
    # cannot spoof the token. So the scan's success is reported on the first line
    # and the bypass is refused outright when it failed: detection still arms on
    # the raw text (the recoverable direction for detection), while the bypass
    # fails closed (the recoverable direction for an escape hatch). Each half
    # fails toward the harmless outcome for what it governs.
    scanned = strip_quoted_indexed(text)
    if scanned is None:
        view = text
        values = []
    else:
        view, values = scanned

    def segment_after(end):
        """Text from `end` to the next command separator — one invocation's args."""
        seg = view[end:]
        # `\n` is a command separator in bash exactly like `;`/`&`/`|`, but was
        # missing here: a compound like `git add board.md\ngit commit -m x` let
        # the `git add` match's segment run FORWARD past the newline into the
        # next line's tokens (misread as bogus pathspecs), and
        # `git commit -m x\ngit branch -a` let the commit match's segment run
        # forward into the next line's `-a`, misread as that commit's own
        # auto-stage flag — both misattribution shapes runtime-confirmed (probe
        # cases: "newline-joined add + commit" pathspec leak, and "newline-joined
        # commit + `git branch -a`" auto-stage leak).
        stop = re.search(r"[;&|\n]", seg)
        return seg[: stop.start()] if stop is not None else seg

    matches = list(COMMIT_RE.finditer(view))
    commits = len(matches)
    # Finding ONE bypass is not enough: the hook exits for the WHOLE tool call, so a
    # single prefixed commit would waive the check for every OTHER commit beside it
    # (`git commit -m unrelated && TZUROT_ALLOW_BOARD_ON_FEATURE=1 git commit -m
    # doc`). Every other gap in this file degrades toward BLOCKING; that one would
    # degrade toward granting. So the count is reported and the caller requires
    # EVERY invocation to carry the prefix (probe case: "a bypass on one commit does
    # not waive a bypass-free commit beside it").
    bypassed = sum(1 for _ in BYPASS_RE.finditer(view))
    autostage = any(AUTOSTAGE_RE.search(segment_after(m.end())) is not None for m in matches)
    add_args = []
    # `re.finditer(r"\S+", …)` rather than `.split()`: the token's OFFSET in the
    # view is what locates its placeholders below, and `.split()` throws that
    # away. `\S+` selects the identical tokens `.split()` did — both are
    # Unicode-whitespace-aware — so the NBSP handling elsewhere in the scan is
    # unchanged. The index for a token is the number of `QUOTED_SPAN` characters
    # in the view BEFORE that token, so a span appearing earlier in the command
    # (an unrelated quoted argument) cannot be mistaken for this token's value.
    # Under the raw fallback (unterminated quote) `values` is empty and the view
    # holds no placeholders, so this reduces to the old plain split.
    for m in ADD_RE.finditer(view):
        seg_start = m.end()
        for tok in re.finditer(r"\S+", segment_after(seg_start)):
            start = seg_start + tok.start()
            resolved, _ = resolve_placeholders(
                tok.group(), values, view.count(QUOTED_SPAN, 0, start)
            )
            add_args.append(resolved)

    scan_ok = scanned is not None

    # A `bash -c` / `sh -c` / `eval` wrapper hands its string argument to a
    # shell as a command, so each unwrapped inner string is assessed as a
    # command in its own right, to a depth of MAX_WRAPPER_DEPTH.
    if depth < MAX_WRAPPER_DEPTH:
        for inner in wrapped_command_strings(text):
            inner_ok, inner_commits, inner_bypassed, inner_autostage, inner_add = scan(
                inner, depth + 1
            )
            # A failed strip anywhere refuses the bypass, which is the
            # existing fail-closed direction for the escape hatch; detection
            # still arms on that level's raw text regardless.
            scan_ok = scan_ok and inner_ok
            commits += inner_commits
            bypassed += inner_bypassed
            autostage = autostage or inner_autostage
            add_args.extend(inner_add)

    return scan_ok, commits, bypassed, autostage, add_args


scan_ok, commit_count, bypassed_count, autostage, add_args = scan(cmd, 0)

# OUTPUT CONTRACT — five fields: fields 1-4 are one line each and read with
# plain `read`. Field 5 is the REMAINDER — one add pathspec per line, printed
# last — because a pathspec can legitimately contain spaces (a fixture path
# like `src/my file.ts`), so a whitespace-joined field could not be re-split
# without re-introducing the word-splitting this parsing exists to avoid.
#   1  SCAN_OK | SCAN_FAILED   2  commit count   3  bypassed count
#   4  auto-stage 0|1          5  add pathspecs, one per line (remainder)
print("SCAN_OK" if scan_ok else "SCAN_FAILED")
print(commit_count)
print(bypassed_count)
print(1 if autostage else 0)
for path in add_args:
    print(path)
PYEOF2
) || exit 0
# `$(…)` strips trailing newlines, so an empty pathspec field is simply absent
# and its `read` sees EOF. Every field is pre-set to its inert value first, both
# for that case and so `set -u` cannot fire on a truncated scan.
QUOTE_SCAN=SCAN_FAILED
COMMIT_COUNT=0
BYPASSED_COUNT=0
AUTOSTAGE=0
ADD_ARGS=""
{
  read -r QUOTE_SCAN
  read -r COMMIT_COUNT
  read -r BYPASSED_COUNT
  read -r AUTOSTAGE
  ADD_ARGS=$(cat)
} <<< "$SCAN"

# Pre-filter: an actual `git [global-flags] commit` invocation, not any command
# that merely contains the substrings ("legit", grep patterns). commit-tree and
# commit-graph are plumbing, not commits — the pattern's `(?![-\w])` right
# boundary rejects them, so no separate exclusion is needed (and a whole-command
# substring scan wrongly exited on PATHSPECS containing those tokens).
[ "$COMMIT_COUNT" -eq 0 ] && exit 0

# Bypass, two paths. The DOCUMENTED form is an env-assignment prefix on the
# very command being inspected — and a PreToolUse hook runs BEFORE that command
# executes, so the prefix has been applied to nothing and can never appear in
# this process's own environment. Read it out of the command text instead.
# BYPASS_RE above is matched against the scanned view, never the raw $COMMAND:
# quoted spans are already stripped there, so a commit MESSAGE merely containing
# the token cannot disable the gate (probe case: "bypass token inside a commit
# message does not open a hole"). The pattern requires an actual assignment — so
# a bare mention is not a bypass (probe case: "bare token mention with no = is
# not a bypass"). Its anchoring, its scoped case-sensitivity, and the reason the
# COUNT rather than a single match decides the question are all documented at
# the pattern itself.
#
# Not a gap: a backslash-continued prefix (assignment ending `\`, `git commit`
# on the next physical line) IS recognised and grants the bypass. The pattern
# never has to cross the `\` itself — `strip_quoted` collapses the
# continuation before this scan runs, so the view it matches against already
# reads as one logical line, exactly as bash treats it. Runtime-confirmed.
#
# The process-env check stays as a second path for a caller that exported it.
#
# QUOTE_SCAN gates the bypass but not detection: on a failed scan the view is
# raw text, where a commit MESSAGE could put the token in prefix position. No
# probe pins this today and none can — such a spoof needs a `git ... commit`
# inside the message too, so the all-commits-carry-it count blocks it first and
# an assertion here would pass with this clause removed. Kept as belt-and-braces
# for the day that count rule changes; stated rather than silently assumed.
if [ "$QUOTE_SCAN" = SCAN_OK ] \
  && [ "$BYPASSED_COUNT" -gt 0 ] && [ "$BYPASSED_COUNT" -eq "$COMMIT_COUNT" ]; then
  exit 0
fi
[ -n "${TZUROT_ALLOW_BOARD_ON_FEATURE:-}" ] && exit 0

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
BRANCH=$(git -C "$ROOT" branch --show-current 2>/dev/null) || exit 0

# Long-lived and release-shaped branches are exactly where board/doc commits
# belong (release-notes edits ride release branches) — never block there.
case "$BRANCH" in
  develop | main | '' | release/* | chore/release-*) exit 0 ;;
esac

# The file set this commit would capture, from three sources:
#   (1) the currently-staged set;
#   (2) when a commit invocation carries -a/-am/--all in its OWN argument span,
#       the modified tracked set the commit auto-stages;
#   (3) when the SAME command stages first (`git add … && git commit …`),
#       the add's pathspecs — a PreToolUse hook runs before the add, so the
#       staged set alone cannot see the compound shape.
FILES=$(git -C "$ROOT" diff --cached --name-only 2>/dev/null) || exit 0
if [ "$AUTOSTAGE" = 1 ]; then
  MODIFIED=$(git -C "$ROOT" diff --name-only 2>/dev/null) || exit 0
  FILES=$(printf '%s\n%s' "$FILES" "$MODIFIED")
fi
if [ -n "$ADD_ARGS" ]; then
  # ADD_ARGS holds the tokens after EVERY `git add` up to that add's command
  # separator (ADD_RE is scanned with finditer, so a two-add compound
  # contributes both pathspecs, not just the last), one bash word per line —
  # unsplit, so a pathspec containing a space arrives whole rather than as two
  # bogus tokens. Drop flags here. A bare `.`/`-A`/`-u` falls back to the full
  # dirty set — over-inclusion can only WIDEN the file set, and a widened set
  # that gains a non-board file PASSES, the fail-open direction.
  NEED_DIRTY=0
  ADD_PATHS=""
  while IFS= read -r tok; do
    [ -z "$tok" ] && continue
    case "$tok" in
      -A | -u | --update | --all | .) NEED_DIRTY=1 ;;
      -*) : ;;
      *) ADD_PATHS=$(printf '%s\n%s' "$ADD_PATHS" "$tok") ;;
    esac
  done <<< "$ADD_ARGS"
  if [ "$NEED_DIRTY" = 1 ]; then
    # Known gap, accepted: a porcelain rename line yields "old -> new" as one
    # token, which reads as non-board and PASSES — the fail-open direction.
    DIRTY=$(git -C "$ROOT" status --porcelain 2>/dev/null | cut -c4-) || DIRTY=""
    FILES=$(printf '%s\n%s' "$FILES" "$DIRTY")
  fi
  FILES=$(printf '%s\n%s' "$FILES" "$ADD_PATHS")
fi
FILES=$(printf '%s\n' "$FILES" | sed '/^$/d')
[ -z "$FILES" ] && exit 0

# Board/doc allowlist — mirrors 00-critical.md's direct-doc-commit table.
# `(/|$)` accepts both the slashed and BARE directory spellings — git treats
# `add tracker` and `add tracker/` identically, and add-pathspec tokens reach
# this check verbatim from the command text.
NON_BOARD=$(printf '%s\n' "$FILES" | grep -vE \
  '^(\./)?(tracker|backlog|docs)(/|$)|^(\./)?(BACKLOG|CURRENT)\.md$') || true
[ -n "$NON_BOARD" ] && exit 0

RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'
{
  printf "${RED}✖ Board/doc-only commit on feature branch '%s' — these files belong on develop:${NC}\n" "$BRANCH"
  printf '%s\n' "$FILES"
  printf "${YELLOW}  A tracker/board commit here strands: the develop push no-ops as${NC}\n"
  printf "${YELLOW}  \"Everything up-to-date\" and the state is invisible to every query.${NC}\n"
  printf "${YELLOW}  Fix: git stash (or leave staged) → git switch develop → commit there → switch back.${NC}\n"
  printf "${YELLOW}  If this doc genuinely belongs WITH this PR, bypass once:${NC}\n"
  printf "${YELLOW}    TZUROT_ALLOW_BOARD_ON_FEATURE=1 git commit ...${NC}\n"
} >&2
exit 2
