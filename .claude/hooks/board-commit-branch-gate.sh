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
# KNOWN GAPS, named rather than hidden. They fail in OPPOSITE directions, and
# that is deliberate: a missed DETECTION lets a commit through, while a missed
# BYPASS only refuses an escape hatch. Each half fails toward the harmless
# outcome for what it governs. None is a habitual shape here.
#
# Detection gaps — degrade to the gate not firing (a silent pass):
#   - `git -c key=value commit` (any value-taking global flag between `git`
#     and the subcommand) defeats the word-bounded pre-filter; the repo's
#     commit convention never uses global flags on commits.
#   - bundled short flags (`-qa`, `-aq`) defeat the literal `-a`/`-am`
#     auto-stage detection.
#   - a porcelain rename under -a/--all reads as one non-board token (below).
#   - `chore/release-*` matches ANY branch with that prefix, not only real
#     release-cut branches — accepted wideness, same fail-open direction.
#
# Bypass-recognition gaps — degrade to the gate BLOCKING, which is the safe
# direction for an escape hatch (the worst case is a refused bypass, never a
# granted one):
#   - the bypass is recognised only as a bare `VAR=1 git commit` prefix, so
#     `export TZUROT_ALLOW_BOARD_ON_FEATURE=1 && git commit ...` — which really
#     would export it — is refused. The documented form is the bare prefix.
#   - likewise a backslash-continued prefix (assignment on one line, the commit
#     on the next): grep matches within a line.
#   - likewise a subshell-wrapped prefix (`(VAR=1 git commit ...)`), whose `(`
#     is neither start-of-line nor a command separator, and an operator-adjacent
#     prefix with no spaces (`VAR=1&&git commit`), where the value class stops
#     AT the `&` and the whitespace the pattern then requires is not there.
# The threat model is the habitual mis-commit shape (plain `git add tracker/
# && git commit`, 3 observed incidents) — exotic spellings are not written by
# accident, mirroring lossy-pipe-guard's stated boundary.

set -uo pipefail

INPUT=$(cat 2>/dev/null) || exit 0
COMMAND=$(printf '%s' "$INPUT" | jq -r '
  select(.tool_name == "Bash") | .tool_input.command // empty' 2>/dev/null) || exit 0
[ -z "$COMMAND" ] && exit 0

# Cheap raw short-circuit before spawning python: no git+commit tokens at all.
case "$COMMAND" in
  *git*commit*) ;;
  *) exit 0 ;;
esac

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
FLAGS_VIEW=$(GUARD_CMD="$COMMAND" HOOK_LIB="$HOOK_LIB" PYTHONDONTWRITEBYTECODE=1 python3 << 'PYEOF2'
import os
import re
import sys

sys.path.insert(0, os.environ["HOOK_LIB"])
from shell_quotes import strip_quoted

cmd = os.environ.get("GUARD_CMD", "")
cmd = re.sub(r"\$\(cat <<'?\"?(\w+)'?\"?.*?\n\1\s*\)", "MSG", cmd, flags=re.S)
cmd = re.sub(r"<<[-~]?\s*'?\"?(\w+)'?\"?.*?\n\1(?=\s|$)", "HEREDOC", cmd, flags=re.S)
# strip_quoted returns None on an UNTERMINATED quote (and on `$'...'` with an
# escaped \', which its single-quote branch cannot know is not a terminator).
# Printing that directly emitted the literal text "None" as FLAGS_VIEW, which
# matches no `git ... commit`, so the pre-filter exited 0 and the WHOLE gate
# went silently inert on any such command — runtime-confirmed against the
# canonical blocking fixture. Fall back to the raw command, which is what the
# module's docstring tells callers to do and what all three sibling hooks
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
scanned = strip_quoted(cmd)
print("SCAN_OK" if scanned is not None else "SCAN_FAILED")
print(cmd if scanned is None else scanned)
PYEOF2
) || exit 0
# First line is the scan status, the rest is the view. `#*<newline>` trims only
# through the FIRST newline, so a multi-line command's view survives intact.
QUOTE_SCAN=${FLAGS_VIEW%%$'\n'*}
FLAGS_VIEW=${FLAGS_VIEW#*$'\n'}

# What counts as a commit invocation, defined ONCE. Three sites need it — this
# pre-filter, the commit count, and (embedded, after the assignment prefix) the
# bypassed count — and the bypass mechanism rests on the last two agreeing
# exactly: they are compared for equality, so a copy updated in fewer than all
# three places would silently change what that comparison means.
# GIT_COMMIT_RE has no leading boundary because the bypass pattern supplies its
# own left context; the two standalone uses prepend GIT_LEFT.
GIT_COMMIT_RE='git([[:space:]]+-[^[:space:]]+)*[[:space:]]+commit([[:space:]]|$)'
GIT_LEFT='(^|[^[:alnum:]_-])'

# Word-bounded pre-filter: an actual `git [global-flags] commit` invocation,
# not any command that merely contains the substrings ("legit", grep patterns).
# commit-tree / commit-graph are plumbing, not commits.
if ! printf '%s' "$FLAGS_VIEW" | grep -qE "${GIT_LEFT}${GIT_COMMIT_RE}"; then
  exit 0
fi
# (No separate commit-tree/commit-graph exclusion: the pre-filter's
# `commit([[:space:]]|$)` boundary already rejects the plumbing subcommands,
# and a whole-command substring scan wrongly exited on PATHSPECS containing
# those tokens.)

# Bypass, two paths. The DOCUMENTED form is an env-assignment prefix on the
# very command being inspected — and a PreToolUse hook runs BEFORE that command
# executes, so the prefix has been applied to nothing and can never appear in
# this process's own environment. Read it out of the command text instead.
# Matched against FLAGS_VIEW, never the raw $COMMAND: quoted spans are already
# stripped there, so a commit MESSAGE merely containing the token cannot
# disable the gate (probe case: "bypass token inside a commit message does not
# open a hole"). The pattern requires an actual assignment — so a bare mention
# is not a bypass (probe case: "bare token mention with no = is not a bypass").
#
# The match must span the assignment ALL THE WAY THROUGH to a `git ... commit`
# token, because that is what an env-assignment prefix actually means in a
# shell: it governs the one command it precedes. Two weaker anchors were tried
# and both let the token authorize a commit it has nothing to do with —
# accepting it after any whitespace let an UNQUOTED single-token message
# (`git commit -m TZUROT_ALLOW_BOARD_ON_FEATURE=1`, no quoted span for
# strip_quoted to collapse) disable the gate from inside its own message, and
# accepting it merely at segment start let an INERT trailing segment
# (`git commit -m msg; TZUROT_ALLOW_BOARD_ON_FEATURE=1`) do the same — an
# ordinary shell shape, not an exotic one, and grep anchors `^` per LINE, so a
# lone token opening line 2 counted as well. Probe cases pin all four shapes.
#
# Finding a match is not enough: the hook exits for the WHOLE tool call, so one
# prefixed commit would waive the check for every OTHER commit in a compound
# command (`git commit -m unrelated && TZUROT_ALLOW_BOARD_ON_FEATURE=1 git
# commit -m doc`). Every other gap in this file degrades toward BLOCKING; that
# one would degrade toward granting, which is the direction bypass logic must
# never fail in. So count instead of test: bypass only when EVERY `git ...
# commit` invocation carries the prefix (probe case: "a bypass on one commit
# does not waive a bypass-free commit beside it").
#
# Known gap, fail-safe direction: grep matches within a single line, so a
# backslash-continued prefix (assignment on one line, `git commit` on the next)
# is not recognised. That refuses a legitimate bypass — the gate blocks, which
# is the harmless direction — rather than granting one.
#
# The bypass token's own VALUE stops at a control operator as well as at
# whitespace. `;`, `&` and `|` end a word with or without surrounding space, so
# `TZUROT_ALLOW_BOARD_ON_FEATURE=1; git commit` is an unexported assignment
# followed by a SEPARATE command that never sees the variable. A value class
# excluding only whitespace swallows the separator and reads the whole thing as
# one prefixed invocation — a false GRANT, the one direction this check must
# never fail in, and the same inert-assignment reasoning already applied to the
# trailing side (probe cases: "an assignment terminated by <sep> does not carry
# into the commit").
#
# The process-env check stays as a second path for a caller that exported it.
# `grep -o | wc -l`, never `grep -c`: -c counts matching LINES, so a two-commit
# single-line command would count 1 and the comparison below would read as
# "every commit is bypassed".
# Other env assignments may precede ours. This value class excludes only
# whitespace, unlike the bypass token's own value below, and that asymmetry is
# deliberate rather than an oversight: no input was found where letting a
# GENERIC assignment's value swallow a separator grants a bypass bash would
# not, because the token's own match still has to land in prefix position
# afterwards. Tightening it here was tried and reverted — no probe case could
# distinguish the two forms, and an unfalsifiable tightening is indistinguishable
# from no tightening.
ASSIGNMENTS='([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*'
COMMIT_COUNT=$(printf '%s' "$FLAGS_VIEW" \
  | grep -oE "${GIT_LEFT}${GIT_COMMIT_RE}" | wc -l)
BYPASSED_COUNT=$(printf '%s' "$FLAGS_VIEW" \
  | grep -oE "(^|[;&|])[[:space:]]*${ASSIGNMENTS}TZUROT_ALLOW_BOARD_ON_FEATURE=[^[:space:];&|]+[[:space:]]+${ASSIGNMENTS}${GIT_COMMIT_RE}" | wc -l)
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
#   (2) when the command carries -a/-am/--all (word-bounded, quoted spans
#       already stripped), the modified tracked set the commit auto-stages;
#   (3) when the SAME command stages first (`git add … && git commit …`),
#       the add's pathspecs — a PreToolUse hook runs before the add, so the
#       staged set alone cannot see the compound shape.
FILES=$(git -C "$ROOT" diff --cached --name-only 2>/dev/null) || exit 0
case "$FLAGS_VIEW" in
  *' -a '* | *' -am '* | *' -a' | *' -am' | *' -a'$'\n'* | *' -am'$'\n'* | *' --all '* | *' --all' | *' --all'$'\n'*)
    MODIFIED=$(git -C "$ROOT" diff --name-only 2>/dev/null) || exit 0
    FILES=$(printf '%s\n%s' "$FILES" "$MODIFIED")
    ;;
esac
if printf '%s' "$FLAGS_VIEW" | grep -qE '(^|[^[:alnum:]_-])git([[:space:]]+-[^[:space:]]+)*[[:space:]]+add([[:space:]]|$)'; then
  # Tokens after EVERY `git add` up to its command separator (grep -o yields
  # one match per occurrence — a greedy single-pass sed kept only the LAST
  # add and dropped the first add's pathspec from a two-add compound); drop
  # flags. A bare `.`/`-A`/`-u` falls back to the full dirty set —
  # over-inclusion can only WIDEN the file set, and a widened set that gains
  # a non-board file PASSES, the fail-open direction.
  ADD_ARGS=$(printf '%s' "$FLAGS_VIEW" \
    | grep -oE '(^|[^[:alnum:]_-])git([[:space:]]+-[^[:space:]]+)*[[:space:]]+add[[:space:]]+[^;&|]*' \
    | sed -E 's/(^|[^[:alnum:]_-])git([[:space:]]+-[^[:space:]]+)*[[:space:]]+add[[:space:]]+//')
  NEED_DIRTY=0
  ADD_PATHS=""
  for tok in $ADD_ARGS; do
    case "$tok" in
      -A | -u | --update | --all | .) NEED_DIRTY=1 ;;
      -*) : ;;
      *) ADD_PATHS=$(printf '%s\n%s' "$ADD_PATHS" "$tok") ;;
    esac
  done
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
