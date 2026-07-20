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
case "$CMD" in
  *git\ -C\ *|*git\ --git-dir*) exit 0 ;;
esac
if ! grep -qE '(^|[[:space:]&|;])git[[:space:]]' <<<"$CMD"; then
  exit 0
fi
# Strip quoted spans BEFORE the pathspec scan — a commit message like
# `git commit -m "docs: update packages/tooling/README"` contains a path-like
# substring that is NOT a pathspec argument, and matching it would false-block
# (violating this hook's "only ever block an unambiguous mistake" contract).
# Same quote-stripping precedent as git-commit-filter-guard.
SCAN=$(sed -E "s/'[^']*'//g; s/\"[^\"]*\"//g" <<<"$CMD")
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
