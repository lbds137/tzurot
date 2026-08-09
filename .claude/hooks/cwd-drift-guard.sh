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
# No drift → nothing to guard. Normalize trailing slashes before comparing.
[ "${SHELL_CWD%/}" = "${ROOT%/}" ] && exit 0
# Drift outside the repo entirely (some other project) → not our concern.
case "${SHELL_CWD%/}/" in
  "${ROOT%/}/"*) ;;
  *) exit 0 ;;
esac

# A command that OPENS with `cd …` deliberately sets its own cwd, so the
# persistent-shell cwd this guard reads is no longer what git runs against —
# `cd "$CLAUDE_PROJECT_DIR" && git add packages/x` self-corrects to root. Bail
# out (fail-open) rather than false-block on a self-correcting command.
case "$(printf '%s' "$CMD" | sed -E 's/^[[:space:]]+//')" in
  cd\ *) exit 0 ;;
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
# not self-correcting, a bare `git` present), so it runs on a small fraction of
# git commands and none of the non-git ones. If python or the lib is
# unavailable, `|| exit 0` allows the command, which matches this hook's
# fail-safe contract.
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
') || exit 0

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

REL="${SHELL_CWD#"${ROOT%/}"/}"
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
