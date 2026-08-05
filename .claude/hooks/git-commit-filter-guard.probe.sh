#!/bin/bash
# Fixture check for git-commit-filter-guard.sh — run after ANY edit to the
# hook. Asserts the exit-code table over the shapes that matter: a git
# commit/push whose output feeds a filter blocks (exit 2); the same command
# unpiped or feeding a pure pass-through passes; a filter on some OTHER
# pipeline passes; and the plumbing subcommands (`git commit-tree`,
# `git commit-graph`) are not commits and must never block.
#
# This hook reads no git state — it decides purely from the command text —
# so the harness needs no fixture repo, only the JSON payload shape the
# PreToolUse hook receives on stdin.
#
# Colocated with the hook (not packages/tooling) because it IS the hook's
# verification mechanism — a bash exit-code harness over a bash hook, run
# manually on hook edits, with no ops-CLI surface.
#
# Usage: .claude/hooks/git-commit-filter-guard.probe.sh   (from repo root)

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/git-commit-filter-guard.sh"

FAILURES=0

# run <expected-exit> <label> <command>
run() {
  local expected="$1" label="$2" cmd="$3"
  jq -n --arg c "$cmd" '{tool_name:"Bash",tool_input:{command:$c}}' \
    | "$HOOK" >/dev/null 2>&1
  local actual=$?
  if [ "$actual" -eq "$expected" ]; then
    printf 'PASS  (exit %d)  %s\n' "$actual" "$label"
  else
    printf 'FAIL  (exit %d, expected %d)  %s\n' "$actual" "$expected" "$label"
    FAILURES=$((FAILURES + 1))
  fi
}

# --- blocking shapes: a filter downstream of a commit/push -----------------
run 2 "commit piped to tail"                  'git commit -m "x" | tail'
run 2 "commit piped to grep"                  'git commit -m "x" | grep -i error'
run 2 "push piped to tail"                    'git push | tail'
run 2 "push piped to head"                    'git push origin develop | head -5'
run 2 "git -C global-flag commit piped"       'git -C /some/path commit -m "x" | tail'
run 2 "filter behind a pass-through stage"    'git commit -m "x" | cat | tail'
run 2 "commit piped via |& shorthand"         'git commit -m "x" |& grep fatal'

# --- plumbing subcommands are NOT `git commit` ----------------------------
# `-` is a non-word character, so a bare `commit\b` matched these and blocked
# a tree-writing plumbing call that this guard has no business touching.
run 0 "plumbing: commit-tree piped to tail"   'git commit-tree abc1234 | tail'
run 0 "plumbing: commit-graph piped to tail"  'git commit-graph write | tail'
run 0 "plumbing: commit-tree behind -C flag"  'git -C /some/path commit-tree abc1234 | head -1'
# The lookahead sits outside the (commit|push) alternation, so it guards the
# push branch too — `push-all` was a false positive under the bare \b form.
run 0 "plumbing: push-all piped to tail"      'git push-all origin | tail'

# --- non-blocking shapes --------------------------------------------------
run 0 "unpiped commit"                        'git commit -m "x"'
run 0 "unpiped push"                          'git push origin develop'
run 0 "commit into a pure pass-through"       'git commit -m "x" | cat'
run 0 "filter on an unrelated pipeline"       'git status | grep ts && git commit -m "x"'
run 0 "non-git command with a filter"         'pnpm test | tail -20'
run 0 "git log piped to a filter"             'git log --oneline | head -5'
run 0 "commit message merely mentions a pipe" 'git commit -m "fix: stop piping git push | tail"'

# --- malformed / non-Bash input fails OPEN --------------------------------
printf '{"tool_name":"Read","tool_input":{"file_path":"x"}}' | "$HOOK" >/dev/null 2>&1
if [ $? -eq 0 ]; then
  printf 'PASS  (exit 0)  non-Bash tool passes\n'
else
  printf 'FAIL  non-Bash tool should pass\n'
  FAILURES=$((FAILURES + 1))
fi

printf 'not json at all' | "$HOOK" >/dev/null 2>&1
if [ $? -eq 0 ]; then
  printf 'PASS  (exit 0)  malformed tool-input fails open\n'
else
  printf 'FAIL  malformed tool-input should fail open\n'
  FAILURES=$((FAILURES + 1))
fi

printf '' | "$HOOK" >/dev/null 2>&1
if [ $? -eq 0 ]; then
  printf 'PASS  (exit 0)  empty stdin fails open\n'
else
  printf 'FAIL  empty stdin should fail open\n'
  FAILURES=$((FAILURES + 1))
fi

if [ "$FAILURES" -gt 0 ]; then
  printf '\n%d probe(s) FAILED\n' "$FAILURES" >&2
  exit 1
fi
printf '\nAll probes passed\n'
