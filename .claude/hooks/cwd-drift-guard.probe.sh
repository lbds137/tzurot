#!/bin/bash
# Fixture check for cwd-drift-guard.sh — run after ANY edit to the hook.
# Asserts the exit-code table over the shapes that matter: only a bare git
# command with a repo-root-relative pathspec, run from a drifted subdir cwd,
# blocks; everything else (git -C, at-root, pnpm, no-pathspec, subdir-local
# path) passes.
#
# Colocated with the hook — it IS the hook's verification mechanism, a bash
# exit-code harness over a bash hook, run manually on hook edits.
#
# Usage: .claude/hooks/cwd-drift-guard.probe.sh   (from repo root)

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/cwd-drift-guard.sh"
export CLAUDE_PROJECT_DIR=$(cd "$SCRIPT_DIR/../.." && pwd)
ROOT="$CLAUDE_PROJECT_DIR"

fail=0
check() { # $1=expected_exit $2=label $3=json
  echo "$3" | "$HOOK" >/dev/null 2>&1
  local got=$?
  if [ "$got" != "$1" ]; then
    echo "FAIL [$got≠$1]: $2"
    fail=1
  else
    echo "ok   [$got]: $2"
  fi
}

check 2 "drift + repo-root-relative pathspec" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git add packages/tooling/src/x.ts\"},\"cwd\":\"$ROOT/packages/tooling\"}"
check 2 "drift + bare root-file pathspec (CURRENT.md)" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git add CURRENT.md\"},\"cwd\":\"$ROOT/services/bot-client\"}"
check 0 "git -C is root-anchored" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git -C $ROOT add packages/tooling/src/x.ts\"},\"cwd\":\"$ROOT/packages/tooling\"}"
check 0 "shell at repo root (no drift)" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git add packages/tooling/src/x.ts\"},\"cwd\":\"$ROOT\"}"
check 0 "pnpm from a subdir is legitimate" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"pnpm --filter @tzurot/tooling test\"},\"cwd\":\"$ROOT/packages/tooling\"}"
check 0 "git with no pathspec (status)" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git status\"},\"cwd\":\"$ROOT/packages/tooling\"}"
check 0 "subdir-local pathspec (no repo-root prefix)" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git add x.ts\"},\"cwd\":\"$ROOT/packages/tooling\"}"
check 0 "path-like substring only INSIDE a quoted commit message (not a pathspec)" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git commit -m \\\"docs: update packages/tooling/README\\\"\"},\"cwd\":\"$ROOT/services/bot-client\"}"
check 0 "self-correcting: leading cd to root before the git command" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cd \\\"\$CLAUDE_PROJECT_DIR\\\" && git add packages/tooling/src/x.ts\"},\"cwd\":\"$ROOT/packages/tooling\"}"
check 2 "drift + .github pathspec (allowlist completeness)" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git add .github/workflows/ci.yml\"},\"cwd\":\"$ROOT/packages/tooling\"}"
# Two apostrophes STRADDLING a real pathspec. Under the two-pass sed strip this
# replaces, they paired as a single-quoted span and deleted `packages/…` along
# with everything else between them, so the drift went unwarned. The stateful
# scanner sees both as literal text inside their own double-quoted arguments.
check 2 "apostrophes straddling a real pathspec" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git commit -m \\\"it's\\\" && git add packages/tooling/x.ts && echo \\\"don't\\\"\"},\"cwd\":\"$ROOT/packages/tooling\"}"
# The complement: with the scanner in place, a path-like substring that lives
# ONLY inside quotes must still be invisible. Without this, a scanner that
# stripped nothing at all would pass the case above.
check 0 "apostrophes, and the only path is inside quotes" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git commit -m \\\"it's packages/tooling\\\" && echo \\\"don't\\\"\"},\"cwd\":\"$ROOT/services/bot-client\"}"
# Uppercase is a shape the shell accepts, and the detection grep was the last
# case-sensitive `git` gate left in this class after the sibling guards were
# fixed. Without -i this exits 0 and the drift goes unwarned.
check 2 "uppercase GIT is still detected" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"GIT ADD packages/tooling/src/x.ts\"},\"cwd\":\"$ROOT/packages/tooling\"}"
# The anchored form must stay exempt in EITHER case. Making the detector
# case-insensitive without this exemption sent a correctly-anchored uppercase
# command into a false block — the regression that motivated this pair.
check 0 "uppercase but root-anchored is exempt" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"GIT -C $ROOT add packages/tooling/src/x.ts\"},\"cwd\":\"$ROOT/packages/tooling\"}"
check 0 "uppercase --git-dir is exempt" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"GIT --git-dir=$ROOT/.git add packages/tooling/src/x.ts\"},\"cwd\":\"$ROOT/packages/tooling\"}"
# The NEGATIVE half of the exemption, and its absence is what let a `grep -i`
# fold `-C` into `-c`. Those are different flags: `-C <path>` anchors the
# working directory, `-c key=val` overrides config and anchors nothing. This
# repo's own hooks run the `-c` form, so folding them silently dropped the
# drift check for a live shape. Both cases are exempt-direction assertions,
# so only this one can catch the fold.
check 2 "config -c does NOT exempt (it anchors nothing)" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git -c core.pager=cat add packages/tooling/src/x.ts\"},\"cwd\":\"$ROOT/packages/tooling\"}"
check 2 "uppercase GIT -c also does NOT exempt" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"GIT -c core.pager=cat add packages/tooling/src/x.ts\"},\"cwd\":\"$ROOT/packages/tooling\"}"
# `--git-dir` needs a trailing boundary like `-C` has, or a longer flag that
# merely starts with it reads as root-anchored.
check 2 "--git-directory is NOT --git-dir" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git --git-directory=x add packages/tooling/src/x.ts\"},\"cwd\":\"$ROOT/packages/tooling\"}"
# Quoted text merely CONTAINING the anchor flag must not exempt the real
# invocation beside it — the exemption reads the stripped command for exactly
# this reason. This is the quote-content-leaks-into-a-structural-scan class
# the whole PR is about, in the one hook where it survived longest.
check 2 "quoted \"git -C\" does not exempt real drift" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git commit -m \\\"see git -C /somewhere\\\" && git add packages/tooling/src/x.ts\"},\"cwd\":\"$ROOT/packages/tooling\"}"
check 0 "no cwd in payload (fail-safe)" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git add packages/tooling/src/x.ts\"}}"
check 0 "non-Bash tool" \
  "{\"tool_name\":\"Read\",\"tool_input\":{\"file_path\":\"x\"},\"cwd\":\"$ROOT/packages/tooling\"}"

[ "$fail" = 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
