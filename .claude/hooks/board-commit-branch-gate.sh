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
# KNOWN GAPS, named rather than hidden — all degrade to the gate not firing
# (a silent pass), never to a wrong block, and none is a habitual shape here:
#   - `git -c key=value commit` (any value-taking global flag between `git`
#     and the subcommand) defeats the word-bounded pre-filter; the repo's
#     commit convention never uses global flags on commits.
#   - bundled short flags (`-qa`, `-aq`) defeat the literal `-a`/`-am`
#     auto-stage detection.
#   - a porcelain rename under -a/--all reads as one non-board token (below).
#   - `chore/release-*` matches ANY branch with that prefix, not only real
#     release-cut branches — accepted wideness, same fail-open direction.
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
print(strip_quoted(cmd))
PYEOF2
) || exit 0

# Word-bounded pre-filter: an actual `git [global-flags] commit` invocation,
# not any command that merely contains the substrings ("legit", grep patterns).
# commit-tree / commit-graph are plumbing, not commits.
if ! printf '%s' "$FLAGS_VIEW" | grep -qE '(^|[^[:alnum:]_-])git([[:space:]]+-[^[:space:]]+)*[[:space:]]+commit([[:space:]]|$)'; then
  exit 0
fi
# (No separate commit-tree/commit-graph exclusion: the pre-filter's
# `commit([[:space:]]|$)` boundary already rejects the plumbing subcommands,
# and a whole-command substring scan wrongly exited on PATHSPECS containing
# those tokens.)

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
