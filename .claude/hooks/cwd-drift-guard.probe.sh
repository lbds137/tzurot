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
check 0 "no cwd in payload (fail-safe)" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git add packages/tooling/src/x.ts\"}}"
check 0 "non-Bash tool" \
  "{\"tool_name\":\"Read\",\"tool_input\":{\"file_path\":\"x\"},\"cwd\":\"$ROOT/packages/tooling\"}"

[ "$fail" = 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
