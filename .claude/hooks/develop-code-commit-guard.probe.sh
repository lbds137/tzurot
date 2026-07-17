#!/bin/bash
# Fixture check for develop-code-commit-guard.sh — run after ANY edit to the
# hook. Asserts the exit-code table over the command shapes that have
# historically been missed: the first live-probe round only exercised
# single-line `-m "..."` commits and shipped a strip step that silently
# no-opped on the repo's canonical heredoc commit format.
#
# Colocated with the hook (not packages/tooling) because it IS the hook's
# verification mechanism — a bash exit-code harness over a bash hook, run
# manually on hook edits, with no ops-CLI surface.
#
# Usage: .claude/hooks/develop-code-commit-guard.probe.sh   (from repo root)

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/develop-code-commit-guard.sh"
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)

TMP_BASE=$(mktemp -d)
WT="$TMP_BASE/probe-wt"
FEATURE_WT="$TMP_BASE/probe-feature-wt"
cleanup() {
  git -C "$REPO_ROOT" worktree remove "$WT" --force 2>/dev/null
  git -C "$REPO_ROOT" worktree remove "$FEATURE_WT" --force 2>/dev/null
  git -C "$REPO_ROOT" branch -D probe/feature-fixture 2>/dev/null
  rm -rf "$TMP_BASE"
}
trap cleanup EXIT
# --force: the primary checkout routinely sits ON develop (doc commits,
# post-release), and worktree add refuses a branch checked out elsewhere.
# Safe here — the probe never commits, it only reads branch + status.
git -C "$REPO_ROOT" worktree add --force "$WT" develop >/dev/null || {
  echo "FATAL: could not create develop worktree (git error above)" >&2
  exit 1
}
# Second worktree on a FEATURE branch: pins the hook's highest-traffic path
# (stay silent off develop/main) — the branch of the control flow that would
# regress invisibly (fail-open) if the branch check were ever broken.
git -C "$REPO_ROOT" worktree add --force -b probe/feature-fixture "$FEATURE_WT" develop >/dev/null || {
  echo "FATAL: could not create feature worktree (git error above)" >&2
  exit 1
}

FAILURES=0

# run <expected-exit> <label> <command> [space-separated dirty relpaths]
# TARGET_WT selects the worktree (defaults to the develop one).
TARGET_WT=""
run() {
  local expected="$1" label="$2" cmd="$3" dirty="${4:-}" wt="${TARGET_WT:-$WT}" f
  for f in $dirty; do
    mkdir -p "$wt/$(dirname "$f")"
    printf 'probe\n' > "$wt/$f"
  done
  jq -n --arg c "$cmd" '{tool_name:"Bash",tool_input:{command:$c}}' \
    | CLAUDE_PROJECT_DIR="$wt" "$HOOK" >/dev/null 2>&1
  local actual=$?
  for f in $dirty; do
    rm -f "$wt/$f"
  done
  if [ "$actual" -eq "$expected" ]; then
    printf 'PASS  (exit %d)  %s\n' "$actual" "$label"
  else
    printf 'FAIL  (exit %d, expected %d)  %s\n' "$actual" "$expected" "$label"
    FAILURES=$((FAILURES + 1))
  fi
}

CANONICAL_HEREDOC='git add -A && git commit -m "$(cat <<'\''EOF'\''
feat(ai-worker): add pgvector memory retrieval

Body mentioning git commit and TZUROT_ALLOW_DEVELOP_CODE_COMMIT=1 in prose.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"'

EARLY_HEREDOC='cat <<EOF > notes.txt
some generated content
EOF
git commit -m "x"'

run 2 "plain single-line commit, dirty ts"        'git add -A && git commit -m "x"'                        'services/probe.ts'
run 2 "CANONICAL heredoc commit form, dirty ts"   "$CANONICAL_HEREDOC"                                     'services/probe.ts'
run 2 "heredoc earlier in compound, dirty ts"     "$EARLY_HEREDOC"                                         'services/probe.ts'
run 2 "git -C global-flag form, dirty ts"         'git -C /some/path commit -m "x"'                        'services/probe.ts'
run 2 "escape token in MESSAGE prose only"        'git commit -m "prose TZUROT_ALLOW_DEVELOP_CODE_COMMIT=1"' 'services/probe.ts'
run 2 "dirty .claude/rules carve-out"             'git commit -m "x"'                                      '.claude/rules/probe.md'
run 2 "dirty workflow yml"                        'git commit -m "x"'                                      '.github/workflows/probe.yml'
run 2 "dirty json manifest"                       'git commit -m "x"'                                      'packages/probe/package.json'
run 2 "dirty yaml config"                         'git commit -m "x"'                                      'services/probe/config.yaml'
run 2 "dirty Dockerfile"                          'git commit -m "x"'                                      'services/probe/Dockerfile'
run 0 "escape hatch in command position"          'TZUROT_ALLOW_DEVELOP_CODE_COMMIT=1 git commit -m "x"'   'services/probe.ts'
run 0 "escape hatch, canonical heredoc form"      "TZUROT_ALLOW_DEVELOP_CODE_COMMIT=1 $CANONICAL_HEREDOC"  'services/probe.ts'
run 0 "non-git command"                           'echo hello'                                             'services/probe.ts'
run 0 "clean tree commit"                         'git add -A && git commit -m "x"'
run 0 "docs-only dirty file"                      'git commit -m "x"'                                      'docs/probe-notes.md'
# Accepted-tradeoff pin: dirty-tree (not staged-set) design means an
# incidental lockfile diff blocks even a doc-only commit — escape hatch or
# stash is the sanctioned path.
run 2 "mixed tree: doc + incidental lockfile"     'git commit -m "x"'                                      'docs/probe-notes.md probe-lock.yaml'
# Highest-traffic path: feature branches never block, whatever is dirty.
TARGET_WT="$FEATURE_WT"
run 0 "feature branch, dirty ts stays silent"     'git add -A && git commit -m "x"'                        'services/probe.ts'
TARGET_WT=""

if [ "$FAILURES" -gt 0 ]; then
  printf '\n%d probe(s) FAILED\n' "$FAILURES" >&2
  exit 1
fi
printf '\nAll probes passed\n'
