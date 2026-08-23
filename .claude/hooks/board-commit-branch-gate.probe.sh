#!/bin/bash
# Fixture check for board-commit-branch-gate.sh — run after ANY edit to the
# hook. Builds a scratch repo per case so branch + staged-set state is real,
# then asserts the exit-code table: a board-only commit on a feature branch
# blocks (exit 2); the same commit on develop, a mixed commit on a feature
# branch, a release-branch board commit, and the env-var bypass all pass.
#
# Colocated with the hook per the repo's probe convention: a bash exit-code
# harness over a bash hook, run manually on hook edits and by
# `pnpm ops guard:hook-probes`.
#
# Usage: .claude/hooks/board-commit-branch-gate.probe.sh   (from repo root)

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/board-commit-branch-gate.sh"

FAILURES=0
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# make_repo <branch> — fresh repo checked out on <branch>, cwd left inside it.
make_repo() {
  local branch="$1" dir
  dir=$(mktemp -d "$WORK/repo.XXXXXX")
  git -C "$dir" init -q -b develop
  git -C "$dir" -c user.email=probe@x -c user.name=probe commit -q --allow-empty -m init
  if [ "$branch" != "develop" ]; then
    git -C "$dir" checkout -q -b "$branch"
  fi
  echo "$dir"
}

# run <expected-exit> <label> <repo-dir> [env-bypass]
run() {
  local expected="$1" label="$2" dir="$3" bypass="${4:-}"
  local actual
  (
    cd "$dir" || exit 99
    [ -n "$bypass" ] && export TZUROT_ALLOW_BOARD_ON_FEATURE=1
    jq -n '{tool_name:"Bash",tool_input:{command:"git commit -m msg"}}' \
      | "$HOOK" >/dev/null 2>&1
  )
  actual=$?
  if [ "$actual" -eq "$expected" ]; then
    printf 'PASS  (exit %d)  %s\n' "$actual" "$label"
  else
    printf 'FAIL  (exit %d, expected %d)  %s\n' "$actual" "$expected" "$label"
    FAILURES=$((FAILURES + 1))
  fi
}

# --- blocking shape: board-only staged set on a feature branch -------------
DIR=$(make_repo feat/x)
mkdir -p "$DIR/tracker/tasks"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
git -C "$DIR" add tracker/
run 2 "tracker-only commit on feat/x blocks" "$DIR"

# CURRENT.md counts as board too
DIR=$(make_repo feat/x)
echo c > "$DIR/CURRENT.md"
git -C "$DIR" add CURRENT.md
run 2 "CURRENT.md-only commit on feat/x blocks" "$DIR"

# --- passing shapes --------------------------------------------------------
# same staged set on develop
DIR=$(make_repo develop)
mkdir -p "$DIR/tracker/tasks"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
git -C "$DIR" add tracker/
run 0 "tracker-only commit on develop passes" "$DIR"

# mixed set (code + board) on a feature branch is ordinary feature work
DIR=$(make_repo feat/x)
mkdir -p "$DIR/tracker/tasks" "$DIR/src"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
echo x > "$DIR/src/a.ts"
git -C "$DIR" add tracker/ src/
run 0 "mixed code+tracker commit on feat/x passes" "$DIR"

# release-shaped branch: release-notes/doc edits belong there
DIR=$(make_repo chore/release-v9.9.9)
mkdir -p "$DIR/docs"
echo n > "$DIR/docs/notes.md"
git -C "$DIR" add docs/
run 0 "docs commit on chore/release-* passes" "$DIR"

# empty staged set (nothing to assess)
DIR=$(make_repo feat/x)
run 0 "empty staged set passes" "$DIR"

# env-var bypass
DIR=$(make_repo feat/x)
mkdir -p "$DIR/tracker/tasks"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
git -C "$DIR" add tracker/
run 0 "bypass env var passes" "$DIR" bypass

# -a auto-stage: board-only MODIFIED tracked file, nothing staged, -a as the
# LAST token (the trailing-token shape) must still block
DIR=$(make_repo develop)
mkdir -p "$DIR/tracker/tasks"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
git -C "$DIR" add tracker/
git -C "$DIR" -c user.email=probe@x -c user.name=probe commit -q -m board
git -C "$DIR" checkout -q -b feat/x
echo t2 > "$DIR/tracker/tasks/task-1 - probe.md"
(
  cd "$DIR" || exit 99
  jq -n '{tool_name:"Bash",tool_input:{command:"git commit -m msg -a"}}'     | "$HOOK" >/dev/null 2>&1
)
actual=$?
if [ "$actual" -eq 2 ]; then
  printf 'PASS  (exit 2)  trailing -a with board-only modified set blocks\n'
else
  printf 'FAIL  (exit %d, expected 2)  trailing -a with board-only modified set blocks\n' "$actual"
  FAILURES=$((FAILURES + 1))
fi

# -a with a MIXED modified set passes
DIR=$(make_repo develop)
mkdir -p "$DIR/tracker/tasks" "$DIR/src"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
echo x > "$DIR/src/a.ts"
git -C "$DIR" add tracker/ src/
git -C "$DIR" -c user.email=probe@x -c user.name=probe commit -q -m base
git -C "$DIR" checkout -q -b feat/x
echo t2 > "$DIR/tracker/tasks/task-1 - probe.md"
echo x2 > "$DIR/src/a.ts"
(
  cd "$DIR" || exit 99
  jq -n '{tool_name:"Bash",tool_input:{command:"git commit -am msg"}}'     | "$HOOK" >/dev/null 2>&1
)
actual=$?
if [ "$actual" -eq 0 ]; then
  printf 'PASS  (exit 0)  -am with mixed modified set passes\n'
else
  printf 'FAIL  (exit %d, expected 0)  -am with mixed modified set passes\n' "$actual"
  FAILURES=$((FAILURES + 1))
fi

# COMPOUND SHAPE: `git add <board> && git commit` in ONE command, nothing
# staged yet — the PreToolUse hook must see the add's pathspec, not the empty
# staged set. This is the most common real invocation.
DIR=$(make_repo feat/x)
mkdir -p "$DIR/tracker/tasks"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
(
  cd "$DIR" || exit 99
  jq -n '{tool_name:"Bash",tool_input:{command:"git add tracker/ && git commit -m msg"}}' \
    | "$HOOK" >/dev/null 2>&1
)
actual=$?
if [ "$actual" -eq 2 ]; then
  printf 'PASS  (exit 2)  compound add+commit of board files blocks\n'
else
  printf 'FAIL  (exit %d, expected 2)  compound add+commit of board files blocks\n' "$actual"
  FAILURES=$((FAILURES + 1))
fi

# compound add+commit of MIXED paths passes
DIR=$(make_repo feat/x)
mkdir -p "$DIR/tracker/tasks" "$DIR/src"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
echo x > "$DIR/src/a.ts"
(
  cd "$DIR" || exit 99
  jq -n '{tool_name:"Bash",tool_input:{command:"git add tracker/ src/ && git commit -m msg"}}' \
    | "$HOOK" >/dev/null 2>&1
)
actual=$?
if [ "$actual" -eq 0 ]; then
  printf 'PASS  (exit 0)  compound add+commit of mixed paths passes\n'
else
  printf 'FAIL  (exit %d, expected 0)  compound add+commit of mixed paths passes\n' "$actual"
  FAILURES=$((FAILURES + 1))
fi

# --allow-empty must NOT trigger the --all auto-stage branch: board-only
# STAGED set + a dirty non-board file that auto-stage would wrongly admit
DIR=$(make_repo feat/x)
mkdir -p "$DIR/tracker/tasks" "$DIR/src"
echo x > "$DIR/src/a.ts"
git -C "$DIR" add src/
git -C "$DIR" -c user.email=probe@x -c user.name=probe commit -q -m code
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
git -C "$DIR" add tracker/
echo x2 > "$DIR/src/a.ts"
(
  cd "$DIR" || exit 99
  jq -n '{tool_name:"Bash",tool_input:{command:"git commit --allow-empty -m msg"}}' \
    | "$HOOK" >/dev/null 2>&1
)
actual=$?
if [ "$actual" -eq 2 ]; then
  printf 'PASS  (exit 2)  --allow-empty does not smuggle dirty files past the board check\n'
else
  printf 'FAIL  (exit %d, expected 2)  --allow-empty does not smuggle dirty files past the board check\n' "$actual"
  FAILURES=$((FAILURES + 1))
fi

# an unrelated command that merely CONTAINS "git commit" (quoted) never
# blocks, even with board files staged on a feature branch
DIR=$(make_repo feat/x)
mkdir -p "$DIR/tracker/tasks"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
git -C "$DIR" add tracker/
(
  cd "$DIR" || exit 99
  jq -n '{tool_name:"Bash",tool_input:{command:"grep -r \"git commit\" docs/"}}' \
    | "$HOOK" >/dev/null 2>&1
)
actual=$?
if [ "$actual" -eq 0 ]; then
  printf 'PASS  (exit 0)  quoted \"git commit\" inside another command passes\n'
else
  printf 'FAIL  (exit %d, expected 0)  quoted \"git commit\" inside another command passes\n' "$actual"
  FAILURES=$((FAILURES + 1))
fi

# MULTI-LINE HEREDOC MESSAGE (the repo's canonical commit shape): body prose
# containing "git add", "-a", "--all" must NOT feed the detectors. Code-only
# staged set on a feature branch + heredoc body mentioning git add -> passes.
DIR=$(make_repo feat/x)
mkdir -p "$DIR/src"
echo x > "$DIR/src/a.ts"
git -C "$DIR" add src/
(
  cd "$DIR" || exit 99
  CMD='git commit -m "$(cat <<'"'"'EOF'"'"'
docs: explain how git add tracker/ works with -a and --all flags
EOF
)"'
  jq -n --arg c "$CMD" '{tool_name:"Bash",tool_input:{command:$c}}' \
    | "$HOOK" >/dev/null 2>&1
)
actual=$?
if [ "$actual" -eq 0 ]; then
  printf 'PASS  (exit 0)  heredoc body mentioning git add/-a/--all does not spoof detection\n'
else
  printf 'FAIL  (exit %d, expected 0)  heredoc body mentioning git add/-a/--all does not spoof detection\n' "$actual"
  FAILURES=$((FAILURES + 1))
fi

# TWO git add invocations in one compound — BOTH pathspecs must count.
# Non-board first, board second: a mixed commit, must PASS (the greedy
# single-pass extraction saw only the board tail and blocked it).
DIR=$(make_repo feat/x)
mkdir -p "$DIR/tracker/tasks" "$DIR/src"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
echo x > "$DIR/src/a.ts"
(
  cd "$DIR" || exit 99
  jq -n '{tool_name:"Bash",tool_input:{command:"git add src/a.ts && git add tracker/ && git commit -m msg"}}' \
    | "$HOOK" >/dev/null 2>&1
)
actual=$?
if [ "$actual" -eq 0 ]; then
  printf 'PASS  (exit 0)  two-add compound, non-board first, passes as mixed\n'
else
  printf 'FAIL  (exit %d, expected 0)  two-add compound, non-board first, passes as mixed\n' "$actual"
  FAILURES=$((FAILURES + 1))
fi

# board first, non-board second: also mixed, also passes
DIR=$(make_repo feat/x)
mkdir -p "$DIR/tracker/tasks" "$DIR/src"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
echo x > "$DIR/src/a.ts"
(
  cd "$DIR" || exit 99
  jq -n '{tool_name:"Bash",tool_input:{command:"git add tracker/ && git add src/a.ts && git commit -m msg"}}' \
    | "$HOOK" >/dev/null 2>&1
)
actual=$?
if [ "$actual" -eq 0 ]; then
  printf 'PASS  (exit 0)  two-add compound, board first, passes as mixed\n'
else
  printf 'FAIL  (exit %d, expected 0)  two-add compound, board first, passes as mixed\n' "$actual"
  FAILURES=$((FAILURES + 1))
fi

# two-add compound, BOTH board — still blocks
DIR=$(make_repo feat/x)
mkdir -p "$DIR/tracker/tasks" "$DIR/backlog"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
echo b > "$DIR/backlog/now.md"
(
  cd "$DIR" || exit 99
  jq -n '{tool_name:"Bash",tool_input:{command:"git add tracker/ && git add backlog/ && git commit -m msg"}}' \
    | "$HOOK" >/dev/null 2>&1
)
actual=$?
if [ "$actual" -eq 2 ]; then
  printf 'PASS  (exit 2)  two-add compound, both board, blocks\n'
else
  printf 'FAIL  (exit %d, expected 2)  two-add compound, both board, blocks\n' "$actual"
  FAILURES=$((FAILURES + 1))
fi

# BARE directory pathspec (no trailing slash) — git treats `add tracker`
# identically to `add tracker/`, so it must still block
DIR=$(make_repo feat/x)
mkdir -p "$DIR/tracker/tasks"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
(
  cd "$DIR" || exit 99
  jq -n '{tool_name:"Bash",tool_input:{command:"git add tracker && git commit -m msg"}}' \
    | "$HOOK" >/dev/null 2>&1
)
actual=$?
if [ "$actual" -eq 2 ]; then
  printf 'PASS  (exit 2)  bare-directory add pathspec (no slash) blocks\n'
else
  printf 'FAIL  (exit %d, expected 2)  bare-directory add pathspec (no slash) blocks\n' "$actual"
  FAILURES=$((FAILURES + 1))
fi

# a PATHSPEC containing "commit-graph" must not disable the hook
DIR=$(make_repo feat/x)
mkdir -p "$DIR/docs" "$DIR/tracker/tasks"
echo n > "$DIR/docs/commit-graph-notes.md"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
(
  cd "$DIR" || exit 99
  jq -n '{tool_name:"Bash",tool_input:{command:"git add docs/commit-graph-notes.md tracker/ && git commit -m notes"}}' \
    | "$HOOK" >/dev/null 2>&1
)
actual=$?
if [ "$actual" -eq 2 ]; then
  printf 'PASS  (exit 2)  commit-graph in a pathspec does not disable the gate\n'
else
  printf 'FAIL  (exit %d, expected 2)  commit-graph in a pathspec does not disable the gate\n' "$actual"
  FAILURES=$((FAILURES + 1))
fi

# real plumbing subcommand still passes
DIR=$(make_repo feat/x)
mkdir -p "$DIR/tracker/tasks"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
git -C "$DIR" add tracker/
(
  cd "$DIR" || exit 99
  jq -n '{tool_name:"Bash",tool_input:{command:"git commit-tree HEAD^{tree} -m x"}}' \
    | "$HOOK" >/dev/null 2>&1
)
actual=$?
if [ "$actual" -eq 0 ]; then
  printf 'PASS  (exit 0)  git commit-tree plumbing passes\n'
else
  printf 'FAIL  (exit %d, expected 0)  git commit-tree plumbing passes\n' "$actual"
  FAILURES=$((FAILURES + 1))
fi

# CONTRACTION-PAIRING class (the shared-scanner fix): an apostrophe in an
# earlier double-quoted arg + one in the commit message must NOT erase the
# `git commit` between them. Board-only staged on a feature branch -> blocks.
DIR=$(make_repo feat/x)
mkdir -p "$DIR/tracker/tasks"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
git -C "$DIR" add tracker/
(
  cd "$DIR" || exit 99
  CMD='echo "it'"'"'s" && git commit -m "won'"'"'t"'
  jq -n --arg c "$CMD" '{tool_name:"Bash",tool_input:{command:$c}}' \
    | "$HOOK" >/dev/null 2>&1
)
actual=$?
if [ "$actual" -eq 2 ]; then
  printf 'PASS  (exit 2)  cross-quote contraction pairing does not erase the commit\n'
else
  printf 'FAIL  (exit %d, expected 2)  cross-quote contraction pairing does not erase the commit\n' "$actual"
  FAILURES=$((FAILURES + 1))
fi

# ./-prefixed board pathspec still counts as board
DIR=$(make_repo feat/x)
mkdir -p "$DIR/tracker/tasks"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
(
  cd "$DIR" || exit 99
  jq -n '{tool_name:"Bash",tool_input:{command:"git add ./tracker/ && git commit -m msg"}}' \
    | "$HOOK" >/dev/null 2>&1
)
actual=$?
if [ "$actual" -eq 2 ]; then
  printf 'PASS  (exit 2)  ./-prefixed board pathspec blocks\n'
else
  printf 'FAIL  (exit %d, expected 2)  ./-prefixed board pathspec blocks\n' "$actual"
  FAILURES=$((FAILURES + 1))
fi

# non-commit git command never blocks
DIR=$(make_repo feat/x)
mkdir -p "$DIR/tracker/tasks"
echo t > "$DIR/tracker/tasks/task-1 - probe.md"
git -C "$DIR" add tracker/
(
  cd "$DIR" || exit 99
  jq -n '{tool_name:"Bash",tool_input:{command:"git status"}}' \
    | "$HOOK" >/dev/null 2>&1
)
actual=$?
if [ "$actual" -eq 0 ]; then
  printf 'PASS  (exit 0)  non-commit command passes\n'
else
  printf 'FAIL  (exit %d, expected 0)  non-commit command passes\n' "$actual"
  FAILURES=$((FAILURES + 1))
fi

echo
if [ "$FAILURES" -gt 0 ]; then
  echo "board-commit-branch-gate probe: $FAILURES FAILURE(S)"
  exit 1
fi
echo "board-commit-branch-gate probe: all cases pass"
exit 0
