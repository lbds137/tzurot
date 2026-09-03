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
#   - bundled short flags (`-qa`, `-aq`) defeat the literal `-a`/`-am`/`--all`
#     auto-stage detection. Only the auto-stage widening is missed; the commit
#     itself is still detected, so the staged set is still assessed.
#   - a porcelain rename under -a/--all reads as one non-board token (below).
#   - `chore/release-*` matches ANY branch with that prefix, not only real
#     release-cut branches — accepted wideness, same fail-open direction.
#
# Deliberate OVER-arming — the opposite direction, and therefore listed apart
# from the gaps rather than among them. The shared commit pattern's `\b` left
# context arms on a dash-prefixed wrapper name (`my-git commit`), and its `(?i)`
# arms on `GIT COMMIT`. Arming only means the branch and allowlist checks get to
# run: a code-bearing, mixed, or empty file set still passes, so the widened
# side of the pattern cannot produce a wrong BLOCK on its own.
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
from shell_quotes import strip_quoted

cmd = os.environ.get("GUARD_CMD", "")
cmd = re.sub(r"\$\(cat <<'?\"?(\w+)'?\"?.*?\n\1\s*\)", "MSG", cmd, flags=re.S)
cmd = re.sub(r"<<[-~]?\s*'?\"?(\w+)'?\"?.*?\n\1(?=\s|$)", "HEREDOC", cmd, flags=re.S)
# strip_quoted returns None on an UNTERMINATED quote (and on `$'...'` with an
# escaped \', which its single-quote branch cannot know is not a terminator).
# Scanning the literal text "None" matched no `git ... commit`, so the commit
# count came back 0 and the WHOLE gate went silently inert on any such command
# — runtime-confirmed against the canonical blocking fixture. Fall back to the
# raw command, which is what the module's docstring tells callers to do and
# what all three sibling hooks already did. Over-arming is the recoverable
# direction here: blocking still requires every captured file to be a board
# file, so a code commit passes regardless (probe case: "an unterminated quote
# does not disarm the gate").
#
# But the raw text is exactly what the bypass check must NOT run against — its
# whole safety argument is that quoted spans are gone, so a commit MESSAGE
# cannot spoof the token. So the scan's success is reported on the first line
# and the bypass is refused outright when it failed: detection still arms on
# the raw text (the recoverable direction for detection), while the bypass
# fails closed (the recoverable direction for an escape hatch). Each half
# fails toward the harmless outcome for what it governs.
scanned = strip_quoted(cmd)
view = cmd if scanned is None else scanned

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
ASSIGNMENTS = r"(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*"
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
BYPASS_RE = re.compile(
    r"(?:^|[;&|])\s*"
    + ASSIGNMENTS
    + r"TZUROT_ALLOW_BOARD_ON_FEATURE=[^\s;&|]+\s+"
    + ASSIGNMENTS
    + "(?i:" + COMMIT_RE.pattern.removeprefix("(?i)") + ")",
    re.M,
)


def segment_after(end):
    """Text from `end` to the next command separator — one invocation's args."""
    seg = view[end:]
    stop = re.search(r"[;&|]", seg)
    return seg[: stop.start()] if stop is not None else seg


commits = list(COMMIT_RE.finditer(view))
# Finding ONE bypass is not enough: the hook exits for the WHOLE tool call, so a
# single prefixed commit would waive the check for every OTHER commit beside it
# (`git commit -m unrelated && TZUROT_ALLOW_BOARD_ON_FEATURE=1 git commit -m
# doc`). Every other gap in this file degrades toward BLOCKING; that one would
# degrade toward granting. So the count is reported and the caller requires
# EVERY invocation to carry the prefix (probe case: "a bypass on one commit does
# not waive a bypass-free commit beside it").
bypassed = sum(1 for _ in BYPASS_RE.finditer(view))
autostage = any(AUTOSTAGE_RE.search(segment_after(m.end())) is not None for m in commits)
add_args = []
for m in ADD_RE.finditer(view):
    add_args.extend(segment_after(m.end()).split())

# OUTPUT CONTRACT — five fields, one per line, in this order:
#   1  SCAN_OK | SCAN_FAILED   2  commit count   3  bypassed count
#   4  auto-stage 0|1          5  add pathspecs, whitespace-joined
# Every field is a single line by construction. The pathspecs are joined with
# spaces rather than newlines because the caller re-splits them on whitespace
# anyway, which keeps the contract positional — no multi-line field has to be
# printed last, and the caller can read the fields with plain `read`.
print("SCAN_OK" if scanned is not None else "SCAN_FAILED")
print(len(commits))
print(bypassed)
print(1 if autostage else 0)
print(" ".join(add_args))
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
  read -r ADD_ARGS
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
# Known gap, fail-safe direction: a backslash-continued prefix (assignment on
# one line, `git commit` on the next) is not recognised — the `\` between them
# is not whitespace, so the pattern's `\s+` cannot cross it. That refuses a
# legitimate bypass — the gate blocks, which is the harmless direction — rather
# than granting one.
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
  # contributes both pathspecs, not just the last). Drop flags here. A bare
  # `.`/`-A`/`-u` falls back to the full dirty set — over-inclusion can only
  # WIDEN the file set, and a widened set that gains a non-board file PASSES,
  # the fail-open direction.
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
