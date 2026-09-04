#!/bin/bash
# PreToolUse(Bash) hook: block a `git` command that references a repo-root-
# relative pathspec while the persistent shell has drifted into a subdirectory.
# That exact shape (`git add packages/x/y.ts` run from inside `packages/x`)
# resolves to `packages/x/packages/x/y.ts` → "did not match any files", AFTER
# the tests it was gating already passed. It bit four times in one session and
# again while fixing an unrelated hook.
#
# Deliberately NARROW — only the always-wrong shape blocks:
#   - shell cwd != repo root (drift), AND
#   - a bare `git` (no `-C` root anchor), AND
#   - a pathspec that looks repo-root-relative (services/, packages/, …).
# `pnpm` from a subdir is legitimate (resolves the nearest package) and never
# blocks; `git -C <root>` is the sanctioned cross-cwd form and never blocks;
# `git status`/`git log` with no pathspec never block.
#
# FAIL-SAFE: if the payload carries no cwd, or cwd == root, exit 0 (allow).
# The hook can only ever ADD a block on an unambiguous mistake.

set -uo pipefail

INPUT=$(cat)
TOOL_NAME=$(jq -r '.tool_name // empty' <<<"$INPUT" 2>/dev/null || echo "")
[ "$TOOL_NAME" != "Bash" ] && exit 0

CMD=$(jq -r '.tool_input.command // empty' <<<"$INPUT" 2>/dev/null || echo "")
[ -z "$CMD" ] && exit 0

# The shell's persistent cwd, as reported in the hook payload. Absent → allow.
SHELL_CWD=$(jq -r '.cwd // empty' <<<"$INPUT" 2>/dev/null || echo "")
[ -z "$SHELL_CWD" ] && exit 0

ROOT="${CLAUDE_PROJECT_DIR:-}"
[ -z "$ROOT" ] && exit 0

# Quote-stripped copy of the command, computed AT MOST ONCE and only when a
# check actually needs it. Every structural scan below reads it instead of the
# raw text, so argument CONTENT (a commit message, a quoted example command)
# cannot decide a question about the command's SHAPE. The strip is the shared
# stateful scanner (.claude/hooks/lib/shell_quotes.py), not a local sed pair —
# see that module for why two independent quote passes cannot be made correct.
#
# Returns non-zero if python or the lib is unavailable, and every caller treats
# that as "do not block", which matches this hook's fail-safe contract.
SCAN=""
SCAN_READY=0
scan_command() {
  [ "$SCAN_READY" = 1 ] && return 0
  SCAN=$(CMD="$CMD" HOOK_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib" \
    PYTHONDONTWRITEBYTECODE=1 python3 -c '
import os, sys
sys.path.insert(0, os.environ["HOOK_LIB"])
from shell_quotes import strip_quoted
cmd = os.environ.get("CMD", "")
scanned = strip_quoted(cmd)
# An unterminated quote strips NOTHING (see the module docstring). Falling back
# to the raw text can only make this hook MORE likely to block, which is the
# recoverable direction for a command that is a bash syntax error anyway.
sys.stdout.write(cmd if scanned is None else scanned)
') || return 1
  SCAN_READY=1
  return 0
}

# Every command text bash would EXECUTE, one per line: the quote-stripped
# command itself, plus the argument of each `bash -c` / `sh -c` / `zsh -c` /
# `eval` wrapper, recursively. $SCAN alone cannot see those — the wrapper's
# argument IS a quoted span, so the strip that makes `echo "…"` inert erases a
# real invocation with it.
#
# Joined with newlines because the callers' patterns are line-oriented (`^` and
# `$` are per-line under grep), so each segment is matched as its own command
# rather than being concatenated into false adjacency with the next.
#
# Deliberately used ONLY by the tracker refusal below. Feeding executed segments
# to the drift checks further down would change what those block, which is a
# different question from this one and is not what this scan was added for.
#
# Same failure contract as scan_command: non-zero if python or the lib is
# unavailable, and the caller treats that as "do not block".
SCAN_SEGMENTS=""
SEGMENTS_READY=0
scan_executed_segments() {
  [ "$SEGMENTS_READY" = 1 ] && return 0
  SCAN_SEGMENTS=$(CMD="$CMD" HOOK_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib" \
    PYTHONDONTWRITEBYTECODE=1 python3 -c '
import os, sys
sys.path.insert(0, os.environ["HOOK_LIB"])
from shell_quotes import executed_segments
sys.stdout.write("\n".join(executed_segments(os.environ.get("CMD", ""))))
') || return 1
  SEGMENTS_READY=1
  return 0
}

# Lexical path join: collapse `.` and `..` segments without touching the
# filesystem. Deliberately textual — it cannot follow a symlink, which is the
# same resolution the drift comparisons below already do on the payload's cwd,
# and it means the `cd` handling needs no directory to exist.
normalize_path() {
  local input="$1" segment result=""
  # Word-splitting on `/` also performs pathname expansion, so disable globbing
  # for the loop. No save/restore: every call site is a `$(…)` substitution, so
  # `set -f` is scoped to that subshell and cannot reach the caller.
  set -f
  local IFS='/'
  for segment in $input; do
    case "$segment" in
      ''|.) ;;
      ..) result="${result%/*}" ;;
      *) result="$result/$segment" ;;
    esac
  done
  printf '%s' "${result:-/}"
}

# A command that OPENS with `cd …` sets its own working directory, so the
# persistent-shell cwd in the payload is not what the LATER steps of the chain
# run against. Resolve the target and use it as the effective cwd below.
#
# The blanket allow this replaces failed open on the shape with the highest
# cost:
#   cd packages/x && npx vitest … && git checkout -- packages/x/src/File.ts
# The git step runs from packages/x, the repo-relative pathspec resolves to
# packages/x/packages/x/… and matches nothing. Those are canary reverts, so the
# silent failure leaves a deliberate mutation applied to a production source
# file, after the test output that would have shown it has scrolled away.
#
# Only a single literal directory token is resolved. A variable, a
# substitution, a glob, a `~`, a quoted target, a BACKSLASH, or anything else
# this cannot read with certainty falls through to the ORIGINAL allow-on-`cd`
# behaviour for the DRIFT checks — this hook must never block a command it does
# not understand, and the `cd "$CLAUDE_PROJECT_DIR" && …` self-correction is
# exactly such a target.
#
# The backslash is in that class because the separator strip below runs BEFORE
# this classification and is blind to escaping: it truncates at the first
# `|`/`&`/`;` whether or not a backslash precedes it, so `cd foo\&bar && …`
# leaves the fragment `foo\` — a directory the command never enters. Treating
# any backslash as unreadable keeps that shape falling open instead of
# computing a wrong effective cwd, which is the invariant this whole block
# rests on. Pinned by the "escaped separator in a cd target" probe fixture.
#
# That allow is DEFERRED rather than taken here, because it is not the whole
# hook: the tracker refusal below must still run. An unresolvable target is
# recorded in CD_UNRESOLVED and the allow is taken immediately after that
# refusal, so EFFECTIVE_CWD stays at the shell's pre-`cd` cwd for it — an
# unresolvable target is no evidence the shell left the worktree, so "unknown
# destination from inside a worktree" is treated as still inside it. That is
# the safe direction: a false refusal costs one extra Bash call to recover
# from, while a miss files a task into a tree no query can reach.
EFFECTIVE_CWD="$SHELL_CWD"
CD_UNRESOLVED=0
CMD_HEAD=$(printf '%s' "$CMD" | sed -E 's/^[[:space:]]+//')
# grep DRAINS rather than `-q`-quits: under pipefail an early exit kills the
# producer with SIGPIPE and a real match reports as failure. Full reasoning
# lives above the resolver in pr-body-ref-gate.sh.
if printf '%s' "$CMD_HEAD" | grep -E '^cd[[:space:]]' >/dev/null; then
  CD_TARGET=$(printf '%s' "$CMD_HEAD" \
    | sed -E 's/^cd[[:space:]]+//; s/[[:space:]]*[|&;].*$//; s/[[:space:]]+$//')
  case "$CD_TARGET" in
    ''|-*|*'$'*|*'`'*|*'*'*|*'?'*|*'['*|*'~'*|*'"'*|*"'"*|*\\*|*' '*) CD_UNRESOLVED=1 ;;
    /*) EFFECTIVE_CWD=$(normalize_path "$CD_TARGET") ;;
    *)  EFFECTIVE_CWD=$(normalize_path "${SHELL_CWD%/}/$CD_TARGET") ;;
  esac
fi

# The tracker store and the board belong to the MAIN checkout. A `pnpm tracker`
# MUTATION run from a linked worktree writes the task file into that worktree's
# own tracker/, where no query can reach it — and the id it is issued is the one
# the worktree's base knew about, so it collides with one develop already gave
# out. `pnpm` is otherwise never blocked by this hook, so the match is narrow:
# mutating subcommands only, read-only queries stay allowed.
#
# THIS RUNS BEFORE EVERY EARLY EXIT, and the ordering is the whole
# correctness of it. Four of them would each let the mutation through:
#   - the unresolvable-`cd` allow, which sits ABOVE this block in the source
#     and is deferred to just below it for that reason. It is the one the
#     hook's own recommended self-correction takes
#     (`cd "$CLAUDE_PROJECT_DIR" && pnpm tracker task create …`), so taking it
#     where it is written made the refusal bypassable by the exact shape this
#     hook tells people to use;
#   - the `git `-presence short-circuit, which no `pnpm` command survives —
#     measured, this is the one that actually fired before this check existed;
#   - the no-drift exit, since CLAUDE_PROJECT_DIR may name the worktree itself
#     for an agent running inside one (design reason, not fixture-pinned — the
#     probe's CLAUDE_PROJECT_DIR is always the checkout it runs from);
#   - the worktree-root toplevel exemption further down, which a tracker write
#     must not inherit.
# Pinned by fixtures whose cwd is a worktree ROOT, where all four apply.
#
# "Is this a linked worktree" is asked of GIT, not of the path. A
# `.claude/worktrees/` prefix test was the obvious cheaper form and is wrong in
# both directions: it answers differently depending on whether
# CLAUDE_PROJECT_DIR names the main checkout or the worktree, and it reports
# every path under a worktree-shaped directory as a worktree whether or not one
# is there. `--git-dir` and `--git-common-dir` diverge exactly on a linked
# worktree — measured against git 2.50.1 across all four shapes (main root,
# main subdir, worktree root, worktree subdir).
#
# `--path-format=absolute` is load-bearing: without it a MAIN-checkout
# SUBDIRECTORY reports an absolute `--git-dir` beside a relative
# `../.git` common dir, and a string compare reads that as a worktree — a false
# block on the main checkout, measured. The flag needs git >= 2.31; an older
# git errors, the function returns non-zero, and nothing blocks.
#
# Both halves of the condition — the command shape and the worktree test —
# have their own isolating fixture, and the command grep runs first because it
# is the selective one: no git process starts for any other command.
# Set by is_linked_worktree so the message can name the MAIN checkout rather
# than CLAUDE_PROJECT_DIR, which for an agent running inside a worktree may
# name the worktree itself — the wrong place to send someone.
MAIN_CHECKOUT=""
is_linked_worktree() {
  local dirs git_dir common_dir
  dirs=$(git -C "$1" rev-parse --path-format=absolute \
    --git-dir --git-common-dir 2>/dev/null) || return 1
  git_dir=$(printf '%s' "$dirs" | sed -n '1p')
  common_dir=$(printf '%s' "$dirs" | sed -n '2p')
  [ -n "$git_dir" ] && [ -n "$common_dir" ] && [ "$git_dir" != "$common_dir" ] || return 1
  # The common dir is the main checkout's `.git`, so its parent is that
  # checkout's working tree.
  MAIN_CHECKOUT=$(dirname "$common_dir")
  return 0
}

#
# The preceding-character class includes both QUOTE characters, and that is
# load-bearing on the raw prefilter: in `bash -c "pnpm tracker task create x"`
# the `pnpm` is preceded by a `"`, so without them the cheap grep short-circuits
# and the confirming pass never runs. The confirming pass reads the EXECUTED
# SEGMENTS rather than $SCAN for the other half of the same bug — in $SCAN that
# wrapper argument is already a placeholder, so a mutation inside it is
# invisible. Both halves had to move; either one alone still lets a wrapped
# mutation through.
#
# The BACKTICK is in the class for the prefilter's sake only: `strip_quoted`
# does not treat a substitution as a quoted span, so the confirming pass
# already saw `result=\`pnpm tracker task create x\`` — the cheap grep was the
# sole short-circuit. `executed_segments` does not UNWRAP a substitution
# either, which is deliberate at the lib level: the threat model here is
# habitual command shapes, not evasion, and a caller that wants the spans has
# `substitution_spans`. No lib change goes with this.
TRACKER_MUTATION_RE="(^|[[:space:]&|;(\"'\`])pnpm[[:space:]]+tracker[[:space:]]+(task|doc)[[:space:]]+(create|edit|archive)([[:space:]]|\$)"
if grep -qE "$TRACKER_MUTATION_RE" <<<"$CMD" \
  && scan_executed_segments && grep -qE "$TRACKER_MUTATION_RE" <<<"$SCAN_SEGMENTS" \
  && is_linked_worktree "$EFFECTIVE_CWD"; then
  cat >&2 << MSG
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TRACKER WRITE FROM A WORKTREE — file it from the main checkout
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The shell is inside a linked worktree ('$EFFECTIVE_CWD'), so this
tracker write would land in THAT tree's tracker/ — invisible to every
query until someone notices, and numbered from the ids this worktree's
base happens to contain, so it can collide with one already issued.

Run the tracker write from the main checkout instead:
  '$MAIN_CHECKOUT'
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MSG
  exit 2
fi

# The deferred allow-on-unresolvable-`cd`. Everything below reasons about a
# concrete effective cwd, and there is none — the target was a variable, a
# substitution, a glob or a quoted string. Allowing here keeps the original
# behaviour of the drift checks exactly: never block a command whose working
# directory this hook cannot read.
[ "$CD_UNRESOLVED" = 1 ] && exit 0

# No drift → nothing to guard. Normalize trailing slashes before comparing.
[ "${EFFECTIVE_CWD%/}" = "${ROOT%/}" ] && exit 0
# Drift outside the repo entirely (some other project) → not our concern.
case "${EFFECTIVE_CWD%/}/" in
  "${ROOT%/}/"*) ;;
  *) exit 0 ;;
esac

# Cheap short-circuit: only git commands with a repo-root-relative-looking
# pathspec are candidates. `-C` anywhere means the command is root-anchored.
# Case-insensitive for the same reason as the detector below — and they MUST
# move together. Making only the detector `-i` (as this hook briefly did) leaves
# `GIT -C <root> add packages/x` falling past its own exemption into the
# now-matching detector, and the hook false-blocks a correctly-anchored command.
# Verified by running it: that shape exited 2 before this line was fixed.
#
# Scoped as a grep rather than `shopt -s nocasematch` (which is what the sibling
# guards use) because that shopt is FILE-GLOBAL, and this file compares PATHS
# with `case` further down. On a case-sensitive filesystem `/home/x/Projects`
# and `/home/x/PROJECTS` are different directories; matching them insensitively
# would silently suppress the "drifted outside the repo" bail.
# NOT `grep -i`: that case-folds the whole pattern, so `-C` also matches `-c`,
# and those are different git flags — `-C <path>` anchors the working dir,
# `-c key=val` overrides config and anchors nothing. Folding them exempted
# `git -c core.pager=cat add packages/x` from the drift check entirely, a
# shape this repo's own hooks run. Case-insensitivity belongs on the COMMAND
# token, never on the flag letter, so `git` is spelled out as classes.
# -i for the same reason the sibling guards carry `shopt -s nocasematch`: an
# uppercase invocation is a real shape a shell accepts, and a case-sensitive
# gate here silently skips the drift check. Lower stakes than in the blocking
# guards (a missed warning, not a bypass) — fixed anyway, because leaving the
# last copy of a class is how the class survives.
if ! grep -qiE '(^|[[:space:]&|;])git[[:space:]]' <<<"$CMD"; then
  exit 0
fi

# A LINKED WORKTREE'S ROOT IS NOT DRIFT. Its cwd is never equal to
# CLAUDE_PROJECT_DIR (which names the main checkout) and its `.git` is a FILE
# rather than a directory, so neither check above can recognise it — yet a bare
# `git diff packages/x` from there resolves exactly as it does from the main
# checkout's root, and this hook was blocking it. Every worktree-isolated agent
# paid a retry or a `git -C <absolute-path>` workaround for that false positive.
#
# Asking git for the toplevel is what tells a worktree root apart from a
# package subdirectory, which the drift check must keep catching — a subdir's
# toplevel is its repo root, not itself, so the comparison simply does not
# match there.
#
# Placed AFTER the cheap `git` short-circuit so the spawn happens only for git
# commands from a drifted cwd, and AFTER the tracker refusal above, which a
# worktree root must NOT be exempt from. If git fails for any reason the
# comparison does not match and the existing logic runs unchanged.
TOPLEVEL=$(git -C "$EFFECTIVE_CWD" rev-parse --show-toplevel 2>/dev/null || echo "")
if [ -n "$TOPLEVEL" ] && [ "${TOPLEVEL%/}" = "${EFFECTIVE_CWD%/}" ]; then
  exit 0
fi
# Strip quoted spans BEFORE the pathspec scan — a commit message like
# `git commit -m "docs: update packages/tooling/README"` contains a path-like
# substring that is NOT a pathspec argument, and matching it would false-block
# (violating this hook's "only ever block an unambiguous mistake" contract).
# The strip is the shared stateful scanner (.claude/hooks/lib/shell_quotes.py),
# not a local sed pair. The sed pair it replaces was a third copy of a bug this
# repo has now fixed twice: two independent passes pair raw quote characters
# with no notion of which quote is already open, so an apostrophe in one
# argument pairs with one in a later argument and erases everything between.
#
# Stakes here are LOWER than in the sibling guards and the difference is worth
# keeping straight: this hook only ever ADDS a block, so a mis-strip costs a
# missed drift warning or a false block, never an unreviewed commit. It is
# fixed anyway — leaving the last copy of a class is how the class survives.
#
# The python spawn sits behind every cheap check above (drift detected, in-repo,
# not a worktree root, a bare `git` present), so it runs on a small fraction of
# git commands and none of the non-git ones. The tracker refusal above gates its
# own spawn behind a cheap raw grep for the same reason; the two use different
# scans (that one needs the wrapper-unwrapped segments, this one the plain
# strip) and each memoizes, so a command reaching both pays each at most once.
# If python or the lib is unavailable, `|| exit 0` allows the command, which
# matches this hook's fail-safe contract.
scan_command || exit 0

# The exemption runs on $SCAN, NOT the raw command, and the ordering is the
# whole point: quoted text that merely CONTAINS `git -C ` would otherwise
# exempt the real invocation beside it. Measured — `git commit -m "see git -C
# /somewhere" && git add packages/x.ts` from a drifted cwd exited 0 and the
# drift went unwarned. That is this repo's own quote-content-leaks-into-a-
# structural-scan bug, in the hook whose quote handling was just hardened.
# `--git-dir` carries a trailing boundary for the same reason `-C` does: git
# spells it `--git-dir=<path>` or `--git-dir <path>`, so anything else after
# the token is a different flag. Without it `--git-directory=x` reads as
# root-anchored and skips the drift check.
if grep -qE '[Gg][Ii][Tt][[:space:]]+-C[[:space:]]|[Gg][Ii][Tt][[:space:]]+--git-dir[=[:space:]]' <<<"$SCAN"; then
  exit 0
fi
# Repo-root-relative DIR-prefixed pathspec (the always-wrong drift shape)...
if ! grep -qE '(^|[[:space:]])(services|packages|backlog|docs|prisma|scripts|\.claude|\.github|\.husky)/' <<<"$SCAN"; then
  # ...or a bare root-file pathspec (CURRENT.md/BACKLOG.md — files, so no
  # trailing slash; the dir alternation above can't catch these).
  grep -qE '(^|[[:space:]])(CURRENT|BACKLOG)\.md($|[[:space:]])' <<<"$SCAN" || exit 0
fi

# The EFFECTIVE cwd, so a chain that cd'd into a package dir names that dir
# rather than wherever the shell happened to be sitting beforehand.
REL="${EFFECTIVE_CWD#"${ROOT%/}"/}"
cat >&2 << MSG
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CWD-DRIFT GUARD — command blocked
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The persistent shell is in a subdirectory ('$REL'), but this git
command references a repo-root-relative pathspec. It will resolve
against the subdir ('$REL/$REL/...') and fail with "did not match
any files" — AFTER any tests in the chain already ran.

Per /tzurot-git-workflow § command-shape rules, use either:
  - git -C "\$CLAUDE_PROJECT_DIR" <subcommand> <paths>   (root-anchored), or
  - run the git step in its own call from the repo root.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MSG
exit 2
