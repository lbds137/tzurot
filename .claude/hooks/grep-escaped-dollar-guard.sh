#!/bin/bash
# PreToolUse hook (matcher: Bash) — blocks a grep-family invocation whose
# pattern is a DOUBLE-quoted string containing a backslash-dollar that the
# shell will eat before any program sees it.
#
# The mechanism. Inside double quotes the shell reduces `\$` to a bare `$`, so
# `grep -rn "\$extends" path` reaches grep as the pattern `$extends` — the
# backslash the author typed is gone. What the bare `$` then MEANS is
# engine-dependent: engines that anchor a mid-pattern `$` (ugrep, ripgrep, GNU
# grep under `-E`/`-P`) match nothing and exit 1, and that empty result reads
# as a genuine absence; GNU grep's basic mode and plain `git grep` treat the
# same `$` as a literal and match by accident. So the form is either silently
# wrong or merely lucky depending on which `grep` a PATH resolves to, while
# the single-quoted `'\$extends'` is correct on every engine and mode.
# Measured on ugrep 7.8.4 and GNU grep 3.11; not claimed for engines beyond
# those two.
#
# Because the correction is the same one-character change in every engine, a
# block on a form that only works by an engine accident is intended behaviour
# rather than a false positive. Plain `grep` and plain `git grep` are therefore
# in scope alongside `-E`/`-P` and `rg`.
#
# Three independent checks must ALL match on the SAME command segment for a
# block:
#   (a) the segment is a grep-family invocation at command position — after
#       optional leading NAME=value assignments, the first word is `grep`,
#       `egrep`, `rg`, or `git grep`, where git's own global options
#       (`-C <dir>`, `--no-pager`, `-c k=v`) may sit between `git` and `grep`.
#       Only option-shaped tokens may, so an ordinary subcommand keeps
#       `git commit -m "grep …"` out of scope. A single opening group
#       character — the `(` of a subshell or the `{` of a brace group — is
#       stepped over before that first word is read, so a grep written as the
#       first command inside a group is still seen
#                                         (probe case 11 pins the non-grep
#                                          negative; cases 22, 23 pin the
#                                          option form, case 24 the subcommand;
#                                          cases 29, 30 pin the group openers)
#   (b) the segment carries no fixed-strings flag, combined short flags
#       included. The flag scan walks quoted runs the same way check (c) does,
#       so flag-shaped text inside a quoted PATTERN does not count as a flag
#                                         (probe cases 3, 4 pin the negative;
#                                          case 20 pins the quote scoping,
#                                          case 21 a real flag written after
#                                          the pattern)
#   (c) a double-quoted run contains a backslash-dollar that is NOT itself
#       preceded by a backslash, followed by an identifier character
#                                         (probe case 1 pins the positive)
#
# The lookbehind in (c) is what keeps the CORRECT three-backslash form
# `"\\\$extends"` silent — the shell reduces that to `\$extends`, which grep
# reads as a literal dollar (probe case 7). The quoted-run prefix in (c) walks
# quotes from the start of the segment, consuming COMPLETE runs of BOTH kinds —
# single-quoted and double-quoted, the latter with escaped pairs eaten as pairs
# — before it opens the run it tests. Walking is what stops a CLOSING double
# quote from being mistaken for an opening one, which would otherwise block
# `grep --include="*.ts" '\$extends' .` on the single-quoted pattern that
# follows a quoted flag value (probe case 16). Carrying the double-quoted
# alternative is what lets the walk get PAST an earlier double-quoted argument
# to reach the real pattern: without it, `--include="*.ts"` or a first `-e`
# pattern absorbs the only quote the scan can open, and the failing pattern
# after it is missed entirely (probe cases 18, 19). Laziness preserves both:
# at each `"` the engine first tries opening it as the pattern run, and only on
# failure backtracks to eat it as a complete run.
#
# Scope limits, by decision rather than by accident:
#   - Bare `"$ident"` with no backslash is OUT of scope. `grep "$PATTERN" f` is
#     the correct idiom for a variable pattern, and a hook sees command text
#     rather than the shell environment, so it cannot tell a defined variable
#     from a mistyped literal (probe case 12).
#   - The identifier class after the backslash-dollar is `[A-Za-z_{]`. The
#     brace is IN scope: once the shell has eaten the backslash, `"\${slug}"`
#     leaves a bare `$` that the same engines anchor exactly as they do in the
#     bare form, and brace-form template-literal searches are common in this
#     repo (probe case 25). A DIGIT is still OUT of scope — `"\$1"` is a
#     positional parameter far more often than a pattern.
#   - The `\b` after the program name in check (a) is a word boundary, so a
#     wrapper script named like `grep-secrets.sh` also reads as a grep
#     invocation. Not probed; it is harmless in the blocking direction only
#     when the rest of the shape also matches, and a wrapper invoked with a
#     double-quoted backslash-dollar pattern carries the same bug the hook
#     is named for.
#   - A backslash-dollar with nothing identifier-like after it is out of scope,
#     which leaves an intentional trailing anchor alone (probe cases 5, 6).
#
# Known limit: the segment split is textual. The heredoc instance of that is
# now HANDLED rather than merely stated — the shared stripper removes heredoc
# bodies before the split runs, so a body line that merely QUOTES the failing
# form is gone by the time segments exist (probe case 26), while a real grep
# after the terminator still blocks (probe case 27). What remains is a `|`,
# `;`, `&&`, or `&` INSIDE a quoted string on a SINGLE line, which still
# fragments the segment at a place the shell would not. In every shape the probe
# exercises, the cost of that is a MISS — probe case 15 is the nearest probed
# shape, where a chained non-grep segment is correctly left alone. A false
# BLOCK is also possible and is NOT probed: a fragment that happens to begin
# with a grep word, carries no `-F`, and contains the failing pattern shape
# will block even though the text was never a grep command
# (`echo "run: cat f | grep \"\$x\" later"` is such a fragment). TASK-885
# tracks that residue. It is a stated limit rather than a handled case;
# closing it needs real shell parsing, which this hook deliberately does not
# do.
#
# Uses `grep -P` (PCRE) with exit statuses captured explicitly. Fail-open on
# any internal error (grep -P unavailable, a bad pattern, empty input) — a
# broken gate must not block real work.
#
# Bypass when the double-quoted form is deliberate:
#
#   TZUROT_ALLOW_GREP_DOLLAR=1 <command>
#
# Fixture check: run .claude/hooks/grep-escaped-dollar-guard.probe.sh after
# ANY edit to this hook.

set -uo pipefail

INPUT=$(cat)

TOOL_NAME=$(jq -r '.tool_name // empty' <<<"$INPUT" 2>/dev/null || echo "")
[ "$TOOL_NAME" != "Bash" ] && exit 0

GUARD_CMD=$(jq -r '.tool_input.command // empty' <<<"$INPUT" 2>/dev/null || echo "")
[ -z "$GUARD_CMD" ] && exit 0

# Anchored to an assignment position (start of string, or after whitespace,
# `;`, `&`, `|`) and followed by whitespace — a quote- or punctuation-adjacent
# mention of the literal cannot bypass. A prose mention with whitespace on both
# sides still can; flat-string matching cannot close that, only narrow it.
BYPASS_RE='(^|[[:space:];&|])TZUROT_ALLOW_GREP_DOLLAR=1[[:space:]]'
if [[ "$GUARD_CMD" =~ $BYPASS_RE ]]; then
  exit 0
fi

# A heredoc BODY is inert DATA — bash executes no word of a quoted-delimiter
# body however command-shaped it looks — so it comes off the WHOLE command
# BEFORE the segment split below. Without this, the split's own newline
# handling makes every body line its own segment, and a `cat <<'EOF' > f`
# whose body merely QUOTES the failing form false-blocks a command that never
# runs grep (probe case 26). Only the body goes; a real grep after the
# terminator is still reached (probe case 27). The SHARED stripper is imported
# rather than a local regex re-typed here, because it recognizes the bare
# redirect form as well as the `$(cat <<'EOF' … EOF)` spelling — the same
# reason lossy-pipe-guard.sh imports the same function.
#
# GUARD_CMD reaches python through the ENVIRONMENT and is never interpolated
# into the script text: interpolating command text into a script is the class
# of hazard this hook exists to catch.
#
# PYTHONDONTWRITEBYTECODE: the import otherwise drops a __pycache__ into
# .claude/hooks/lib on every guarded command, and a stale .pyc can mask a
# broken edit to the module by importing yesterday's bytecode.
#
# On ANY python failure — python3 absent, the import failing, a non-zero exit —
# the RAW command text is kept. That is the conservative direction rather than
# an allow: the strip only ever REMOVES text, so falling back to the unstripped
# text can only make the scan see MORE, which preserves the pre-existing
# blocking behaviour instead of opening a hole in it.
# A cheap bash-native test gates the spawn: python costs more than every other
# check in this hook combined, and the overwhelming majority of commands carry
# no heredoc at all. lossy-pipe-guard.sh gates the SAME import the same way,
# and states the precedent as do-cheap-checks-first.
#
# Behaviour-preserving in both directions, which is why the gate is a substring
# test rather than anything cleverer. A command with no `<<` has no opener for
# the shared pattern to find, so the strip would hand back the text unchanged.
# The one shape that passes this test WITHOUT being a heredoc is a `<<<`
# here-string: it still spawns python, and the shared opener pattern's `(?<!<)`
# lookbehind then refuses to match it, so the strip is a no-op there too. The
# cost of that shape is a wasted spawn, never a changed verdict.
STRIPPED_CMD="$GUARD_CMD"
case "$GUARD_CMD" in
  *'<<'*)
    HOOK_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
    STRIP_OUT=$(GUARD_CMD="$GUARD_CMD" HOOK_LIB="$HOOK_LIB" PYTHONDONTWRITEBYTECODE=1 python3 -c '
import os
import sys

sys.path.insert(0, os.environ["HOOK_LIB"])
from shell_quotes import strip_heredoc_bodies

sys.stdout.write(strip_heredoc_bodies(os.environ["GUARD_CMD"]))
' 2>/dev/null)
    STRIP_RC=$?
    if [ "$STRIP_RC" -eq 0 ]; then
      STRIPPED_CMD="$STRIP_OUT"
    fi
    ;;
esac

# Split into command segments on `&&`, `||`, `;`, `|`, a single `&`, and
# newlines, so a grep in a later pipeline stage is scanned as its own command —
# probe case 10 pins that, and goes red when the split is removed. The split is
# also what stops a backslash-dollar in a NON-grep segment from borrowing an
# earlier segment's grep; probe case 15 exercises that shape but does not
# ISOLATE the split, because its own `-F` flag blocks it independently — that
# half is unpinned.
#
# The alternation lists `&&` before the single `&` so a chained pair splits
# once; case 15 keeps the `&&` form exercised, and splitting it twice would
# only add an empty fragment, which the loop below skips. A `&` that is part
# of a REDIRECTION (`2>&1`, `>&2`, `&>`) splits too. That is harmless rather
# than correct-by-construction: the grep-bearing segment keeps its whole
# pattern, and the stray fragment (`1`, `2`) starts with no grep word, so
# check (a) drops it (probe case 31). Case 28 is the shape the single `&`
# exists for, and case 32 is its negative — the split only exposes a grep that
# is actually there.
#
# Same mechanism as the phantom-script check in dispatch-spec-ledger-gate.sh;
# newlines in the input already act as splits because `grep -P` is
# line-oriented.
SEGMENTED_TEXT=$(sed -E 's/(\&\&|\|\||;|\||\&)/\n/g' <<<"$STRIPPED_CMD" 2>/dev/null)
SPLIT_RC=$?
if [ "$SPLIT_RC" -ne 0 ]; then
  exit 0
fi

# (a) grep-family at command position, past any leading NAME=value assignments.
#     The git alternative allows git's own global options between `git` and
#     `grep` — `git -C services grep …`, `git --no-pager grep …`,
#     `git -c k=v grep …`. Each intervening token must be option-shaped (a
#     leading `-`) with at most one non-dash value after it, so a plain
#     subcommand word does not qualify (probe cases 22, 23, 24).
#     The optional `[({]?` steps over ONE opening group character, so a grep
#     that opens a subshell or a brace group is still at command position for
#     this check — `(grep …)` and `{ grep …; }` (probe cases 29, 30).
CMDPOS_RE='^\s*[({]?\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:grep|egrep|rg|git(?:\s+-\S+(?:\s+[^\s-]\S*)?)*\s+grep)\b'

# (b) a fixed-strings flag anywhere on the segment; combined short flags such
#     as `-rnF` count. The prefix is the same quoted-run walk check (c) uses,
#     so a flag counts only where it sits OUTSIDE every quoted run: without
#     that scoping, a double-quoted PATTERN containing ` -F ` reads as a flag
#     and the segment is skipped before the eaten check ever runs (probe case
#     20). A real flag written AFTER the pattern is still reached, because the
#     walk consumes the pattern's quoted run whole (probe case 21). The
#     `(?<![^\s])` states the old `(^|\s)` as a zero-width assertion: the flag
#     is preceded by whitespace or by the start of the segment.
FIXED_RE='^(?:[^\x27\x22]|\x27[^\x27]*\x27|\x22(?:[^\x22\\]|\\.)*\x22)*?(?<![^\s])(?:-[A-Za-z]*F[A-Za-z]*(?=\s|$)|--fixed-strings(?=\s|=|$))'

# (c) the failing shape. Quote characters are written as \x27 (') and \x22 (")
#     so the whole pattern survives a single-quoted bash assignment untouched —
#     the alternative is escaping quotes and backslashes in a double-quoted
#     string, which is the very hazard this hook exists to catch.
#     Reading it left to right: from the start of the segment, consume
#     non-quote characters and complete single-quoted runs (lazily), open a
#     double quote, consume non-quote characters with escaped pairs eaten as
#     pairs, then require a backslash NOT preceded by a backslash, a dollar,
#     and an identifier character.
EATEN_RE='^(?:[^\x27\x22]|\x27[^\x27]*\x27|\x22(?:[^\x22\\]|\\.)*\x22)*?\x22(?:[^\x22\\]|\\.)*?(?<!\\)\\\$[A-Za-z_{]'

# grep exit codes: 0 = match, 1 = no match, 2 = error (bad pattern, no PCRE
# support). Only a clean (a) match + (b) non-match + (c) match blocks; a grep
# error on any check falls through to allow.
BLOCKING_SEGMENT=""
while IFS= read -r SEGMENT; do
  [ -z "$SEGMENT" ] && continue

  grep -Pq "$CMDPOS_RE" <<<"$SEGMENT" 2>/dev/null
  CMDPOS_RC=$?
  [ "$CMDPOS_RC" -ne 0 ] && continue

  grep -Pq "$FIXED_RE" <<<"$SEGMENT" 2>/dev/null
  FIXED_RC=$?
  # 0 = a fixed-strings flag is present (allow); 2 = grep error (fail open).
  [ "$FIXED_RC" -ne 1 ] && continue

  grep -Pq "$EATEN_RE" <<<"$SEGMENT" 2>/dev/null
  EATEN_RC=$?
  [ "$EATEN_RC" -ne 0 ] && continue

  BLOCKING_SEGMENT="$SEGMENT"
  break
done <<<"$SEGMENTED_TEXT"

[ -z "$BLOCKING_SEGMENT" ] && exit 0

cat >&2 <<'EOF'
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GREP ESCAPED-DOLLAR GUARD — the shell eats the backslash before grep sees it
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Inside double quotes the shell reduces `\$` to a bare `$`, so grep never
receives the backslash you typed. An engine that anchors a mid-pattern `$`
then matches nothing and exits 1 — and that empty result reads as a genuine
absence rather than as a broken pattern.

Single-quote the pattern, or search for it literally:

  grep -rn '\$extends' <path>
  grep -rnF '$extends' <path>

Deliberate double-quoted use: prefix the command with
TZUROT_ALLOW_GREP_DOLLAR=1 to pass this gate.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
exit 2
