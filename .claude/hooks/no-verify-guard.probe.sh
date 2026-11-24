#!/bin/bash
# Fixture check for no-verify-guard.sh — run after ANY edit to the hook. The
# skip-shape rows decide purely from the command text, so they need only the
# JSON payload shape the PreToolUse hook receives on stdin; `run` pins their
# payload cwd to "$T/plain/sub", a plain non-git dir with no sibling `wt`, so
# the hooks-presence arm stays inert for them and a `../wt` in a row cannot
# resolve to the real uninstalled fixture worktree. The hooks-presence rows
# use throwaway fixture repos built in a temp dir (an installed project,
# uninstalled/partial/non-executable worktrees, a foreign repo, a plain dir)
# and `run_in` to choose the payload cwd. Global git config is isolated,
# since the machine's own sets core.hooksPath.
#
# Usage: .claude/hooks/no-verify-guard.probe.sh   (from anywhere)

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/no-verify-guard.sh"

FAILURES=0

T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR
# CI sets GITHUB_ACTIONS=true, which switches the hooks-presence arm off.
unset GITHUB_ACTIONS

# Installed project: husky-style shims, relative core.hooksPath, .husky/_
# untracked so a worktree of it lacks the shims.
git init -q "$T/proj"
mkdir -p "$T/proj/.husky/_"
for h in pre-commit commit-msg pre-push; do
  printf '#!/bin/sh\nexit 0\n' >"$T/proj/.husky/_/$h"
  chmod +x "$T/proj/.husky/_/$h"
done
git -C "$T/proj" config core.hooksPath .husky/_
git -C "$T/proj" -c user.name=probe -c user.email=probe@example.invalid \
  commit -q --allow-empty -m init
git -C "$T/proj" worktree add -q --detach "$T/wt"
git -C "$T/proj" worktree add -q --detach "$T/wt-cm"
git -C "$T/proj" worktree add -q --detach "$T/wt-noexec"
git -C "$T/proj" worktree add -q --detach "$T/wt-pc"
# wt-cm: the commit hooks (pre-commit, commit-msg), no pre-push. wt-noexec:
# commit-msg + pre-push, pre-push not executable. wt-pc: commit-msg + pre-push,
# no pre-commit.
mkdir -p "$T/wt-cm/.husky/_" "$T/wt-noexec/.husky/_" "$T/wt-pc/.husky/_"
for h in pre-commit commit-msg; do
  printf '#!/bin/sh\nexit 0\n' >"$T/wt-cm/.husky/_/$h"
  chmod +x "$T/wt-cm/.husky/_/$h"
done
for h in commit-msg pre-push; do
  printf '#!/bin/sh\nexit 0\n' >"$T/wt-pc/.husky/_/$h"
  chmod +x "$T/wt-pc/.husky/_/$h"
done
for h in commit-msg pre-push; do
  printf '#!/bin/sh\nexit 0\n' >"$T/wt-noexec/.husky/_/$h"
done
chmod +x "$T/wt-noexec/.husky/_/commit-msg"
chmod -x "$T/wt-noexec/.husky/_/pre-push"
git init -q "$T/foreign"
# Never-installed clone: default (sample-only) .git/hooks, no core.hooksPath.
git init -q "$T/clone"
git -C "$T/clone" -c user.name=probe -c user.email=probe@example.invalid \
  commit -q --allow-empty -m init
mkdir -p "$T/plain/sub"
# A git that fails for everything, for the fail-open row.
mkdir -p "$T/fakegit"
printf '#!/bin/sh\nexit 1\n' >"$T/fakegit/git"
chmod +x "$T/fakegit/git"

# run_in <expected-exit> <label> <cwd> <command>
run_in() {
  local expected="$1" label="$2" cwd="$3" cmd="$4"
  jq -n --arg c "$cmd" --arg d "$cwd" \
    '{tool_name:"Bash",cwd:$d,tool_input:{command:$c}}' \
    | CLAUDE_PROJECT_DIR="$T/proj" "$HOOK" >/dev/null 2>&1
  local actual=$?
  if [ "$actual" -eq "$expected" ]; then
    printf 'PASS  (exit %d)  %s\n' "$actual" "$label"
  else
    printf 'FAIL  (exit %d, expected %d)  %s\n' "$actual" "$expected" "$label"
    FAILURES=$((FAILURES + 1))
  fi
}

# run_in_env <expected-exit> <label> <cwd> <command> <VAR=value>
# Like run_in, with one extra variable in the HOOK's own environment only
# (placed after CLAUDE_PROJECT_DIR, so `env` lets it override that too).
run_in_env() {
  local expected="$1" label="$2" cwd="$3" cmd="$4" extra="$5"
  jq -n --arg c "$cmd" --arg d "$cwd" \
    '{tool_name:"Bash",cwd:$d,tool_input:{command:$c}}' \
    | env CLAUDE_PROJECT_DIR="$T/proj" "$extra" "$HOOK" >/dev/null 2>&1
  local actual=$?
  if [ "$actual" -eq "$expected" ]; then
    printf 'PASS  (exit %d)  %s\n' "$actual" "$label"
  else
    printf 'FAIL  (exit %d, expected %d)  %s\n' "$actual" "$expected" "$label"
    FAILURES=$((FAILURES + 1))
  fi
}

# run <expected-exit> <label> <tool_name> <command>
run() {
  local expected="$1" label="$2" tool="$3" cmd="$4"
  jq -n --arg t "$tool" --arg c "$cmd" --arg d "$T/plain/sub" \
    '{tool_name:$t,cwd:$d,tool_input:{command:$c}}' \
    | CLAUDE_PROJECT_DIR="$T/proj" "$HOOK" >/dev/null 2>&1
  local actual=$?
  if [ "$actual" -eq "$expected" ]; then
    printf 'PASS  (exit %d)  %s\n' "$actual" "$label"
  else
    printf 'FAIL  (exit %d, expected %d)  %s\n' "$actual" "$expected" "$label"
    FAILURES=$((FAILURES + 1))
  fi
}

# --- blocks ------------------------------------------------------------------
run 2 "commit --no-verify" Bash "git commit --no-verify -m x"
run 2 "commit -n" Bash "git commit -n -m x"
run 2 "commit -nm bundle" Bash "git commit -nm x"
run 2 "commit -an bundle" Bash "git commit -an -m x"
run 2 "-nm with an attached quoted message" Bash 'git commit -nm"fix: x"'
run 2 "-nF with an attached file name" Bash "git commit -nFmsg.txt"
run 2 "-anm with an attached quoted message" Bash "git commit -anm'x'"
run 2 "brace expansion does not end the argument span" Bash "git commit -m x src/{a,b}.ts -n"
run 2 "commit inside a brace group still blocks" Bash "{ git commit -n -m x; }"
run 2 "push --no-verify" Bash "git push --no-verify"
run 2 "push --no-verify with remote and branch" Bash "git push --no-verify origin feat/x"
run 2 "git -C dir commit --no-verify" Bash "git -C /some/dir commit --no-verify -m x"
run 2 "HUSKY=0 commit" Bash "HUSKY=0 git commit -m x"
run 2 "HUSKY=0 push" Bash "HUSKY=0 git push"
run 2 "core.hooksPath global flag" Bash "git -c core.hooksPath=/dev/null commit -m x"
run 2 "bash -c wrapper" Bash 'bash -c "git commit --no-verify -m x"'
run 2 "chained after git add" Bash "git add a && git commit --no-verify -m x"
run 2 "override on one invocation does not waive its sibling" Bash \
  "git commit --no-verify -m a && TZUROT_ALLOW_NO_VERIFY=1 git push --no-verify"
run 2 "quote-adjacent override literal does not bypass" Bash \
  "git commit --no-verify -m 'TZUROT_ALLOW_NO_VERIFY=1 x'"

run 2 "commit 2>&1 then --no-verify" Bash "git commit -m x 2>&1 --no-verify"
run 2 "push 2>&1 then --no-verify" Bash "git push origin x 2>&1 --no-verify"
run 2 "commit &>/dev/null then --no-verify" Bash "git commit -m x &>/dev/null --no-verify"
CMD_CONT=$(printf 'git commit -m x \\\n--no-verify')
run 2 "backslash-newline continuation then --no-verify" Bash "$CMD_CONT"
run 2 "subshell-glued --no-verify)" Bash "(cd ../wt && git push --no-verify)"
run 2 "subshell-glued -n)" Bash "(git commit -m x -n)"
run 2 "redirect-glued --no-verify>/dev/null" Bash "git commit -m x --no-verify>/dev/null"
run 2 "quoted core.hooksPath value in -c" Bash "git -c 'core.hooksPath=/dev/null' commit -m x"
# The override must prefix the INNER invocation, not the wrapper.
run 2 "override on the wrapper does not waive the inner commit" Bash \
  "TZUROT_ALLOW_NO_VERIFY=1 bash -c 'git commit -n -m x'"
run 2 "unquoted \${BRANCH} before --no-verify" Bash 'git push origin ${BRANCH} --no-verify'
run 2 "unquoted \$(cat msg) before -n" Bash 'git commit -m $(cat msg) -n'
run 2 "HEAD@{1} before -n" Bash 'git commit --fixup HEAD@{1} -n'
run 2 "command substitution body is scanned" Bash 'echo $(git commit --no-verify -m x)'
run 2 "env HUSKY=0 commit" Bash "env HUSKY=0 git commit -m x"
run 2 "core.hooksPath on push" Bash "git -c core.hooksPath=/dev/null push"
run 2 "quoted HUSKY=\"0\" commit" Bash 'HUSKY="0" git commit -m x'
run 2 "wholly quoted override word is a command word, not an assignment" Bash \
  "'TZUROT_ALLOW_NO_VERIFY=1' git commit -n"

# --- passes ------------------------------------------------------------------
# A quoted override value is accepted: bash assigns the same 1.
run 0 "quoted override value" Bash 'TZUROT_ALLOW_NO_VERIFY="1" git commit -n'
run 0 "inner unterminated quote fails open" Bash "bash -c \"git commit -m 'a -n b\""
# Named gap, pinned as current behavior: quoted args to non-shell programs.
run 0 "git rebase -x quoted command (named gap)" Bash \
  "git rebase -x 'git commit --amend --no-edit -n'"
# Named gap, pinned as current behavior: HUSKY=0 prefixes the wrapper only.
run 0 "HUSKY=0 on a bash -c wrapper (named gap)" Bash "HUSKY=0 bash -c 'git commit -m x'"
run 0 "-Sn is a signing key id" Bash "git commit -Sn -m x"
run 0 "-uno takes an attached arg" Bash "git commit -uno -m x"
run 0 "-- ends options (pathspec -n)" Bash "git commit -- -n"
run 0 "shell comment mentions -n" Bash "git commit -m x # -n"
run 0 "HUSKY=0 on an unrelated command" Bash "HUSKY=0 pnpm install"
run 0 "HUSKY=0 prefix does not leak across &&" Bash "HUSKY=0 pnpm i && git commit -m x"
run 0 "-n inside a command substitution in the message" Bash 'git commit -m "$(git log -n 1 --format=%s)"'
run 0 "unterminated quote fails open" Bash "git commit -m 'x --no-verify"
run 0 "override prefix with a quoted message before the flag" Bash \
  "TZUROT_ALLOW_NO_VERIFY=1 git commit -m 'x' --no-verify"
# GIT_COMMIT_RE is (?i), so uppercase GIT COMMIT matches the detector, but the
# flag check is case-sensitive: `--NO-VERIFY` is not git's flag, and the
# uppercase `GIT` is not a runnable command on a case-sensitive filesystem.
# Pinned as a pass.
run 0 "uppercase GIT COMMIT --NO-VERIFY (case-sensitive flag check)" Bash \
  "GIT COMMIT --NO-VERIFY -m x"
run 0 "message mentions --no-verify" Bash 'git commit -m "skip --no-verify next time"'
CMD_HEREDOC=$(
  cat <<'CMDEOF'
git commit -F - <<'EOF'
fix: stop using --no-verify and -n
EOF
CMDEOF
)
run 0 "heredoc message mentions --no-verify" Bash "$CMD_HEREDOC"
run 0 "-mn is the message n, not no-verify" Bash "git commit -m x -mn"
run 0 "-mn with an attached quoted value is the message" Bash 'git commit -mn"x"'
run 0 "brace group is still a separator" Bash "{ git commit -m x; } && echo -n done"
run 0 "a brace word stays one pathspec token" Bash "git commit -m x {a,b}-notes.md"
# Named gaps, pinned as current behavior.
run 0 "process substitution ends the span (named gap)" Bash "git commit -F <(echo x) -n"
run 0 "git alias is not resolved (named gap)" Bash "git ci -n"
run 0 "-n belongs to head, not the commit" Bash "head -n 5 file && git commit -m x"
run 0 "grep -n then push" Bash "grep -n x f; git push"
run 0 "push -n is --dry-run" Bash "git push -n"
run 0 "push --dry-run" Bash "git push --dry-run"
run 0 "override prefix on commit" Bash "TZUROT_ALLOW_NO_VERIFY=1 git commit --no-verify -m x"
run 0 "override prefix on push" Bash "TZUROT_ALLOW_NO_VERIFY=1 git push --no-verify"
run 0 "quoted flag in echo does not leak into the chained commit" Bash \
  'echo "--no-verify" && git commit -m x'
run 0 "probe invocation (script commits with --no-verify internally)" Bash \
  ".claude/hooks/claim-shape-guard.probe.sh && git status"
run 0 "git log -n does not leak into the chained commit" Bash \
  "git log --oneline -n 3 && git commit -m x"
run 0 "tool_name Edit is ignored" Edit "git commit --no-verify -m x"

# --- the override announces itself ---------------------------------------------
# (its exit 0 is pinned by the "override prefix on push" row above)
OVERRIDE_ERR=$(jq -n --arg c "TZUROT_ALLOW_NO_VERIFY=1 git push --no-verify" --arg d "$T/plain/sub" \
  '{tool_name:"Bash",cwd:$d,tool_input:{command:$c}}' \
  | CLAUDE_PROJECT_DIR="$T/proj" "$HOOK" 2>&1 >/dev/null)
if printf '%s' "$OVERRIDE_ERR" | grep -qF 'no-verify-guard: override used (git push)'; then
  printf 'PASS  override prints its stderr line\n'
else
  printf 'FAIL  override stderr line missing: %s\n' "$OVERRIDE_ERR"
  FAILURES=$((FAILURES + 1))
fi

# --- hooks-presence arm ---------------------------------------------------------
echo "--- hooks-presence arm ---"
run_in 2 "commit in an uninstalled worktree" "$T/wt" "git commit -m x"
run_in 2 "push in an uninstalled worktree" "$T/wt" "git push"
run_in 2 "git -C absolute uninstalled worktree" "$T/proj" "git -C $T/wt commit -m x"
run_in 2 "git -C relative uninstalled worktree" "$T/proj" "git -C ../wt commit -m x"
run_in 2 "cd into an uninstalled worktree then commit" "$T/proj" "cd $T/wt && git commit -m x"
run_in 2 "cd with semicolon into an uninstalled worktree" "$T/proj" "cd $T/wt; git commit -m x"
run_in 2 "quoted cd with semicolon" "$T/proj" "cd \"$T/wt\"; git commit -m x"
run_in 2 "cd -P into an uninstalled worktree" "$T/proj" "cd -P $T/wt && git commit -m x"
run_in 2 "subshell cd into an uninstalled worktree" "$T/proj" "(cd $T/wt && git commit -m x)"
run_in 2 "uppercase GIT -C COMMIT" "$T/proj" "GIT -C $T/wt COMMIT -m x"
run_in 0 "git -C on another command does not block an installed commit" "$T/proj" \
  "git -C $T/wt status && git commit -m x"
run_in 0 "commit -C reuse-message is not a directory" "$T/proj" "git commit -C HEAD"
run_in 2 "push where pre-push is missing" "$T/wt-cm" "git push"
run_in 2 "push where pre-push is not executable" "$T/wt-noexec" "git push"
run_in 0 "commit in the installed project" "$T/proj" "git commit -m x"
run_in 0 "push in the installed project" "$T/proj" "git push"
run_in 0 "commit where pre-commit and commit-msg exist" "$T/wt-cm" "git commit -m x"
run_in 2 "commit where pre-commit is missing" "$T/wt-pc" "git commit -m x"
run_in 0 "push where pre-push exists but pre-commit is missing" "$T/wt-pc" "git push"
run_in_env 2 "commit in a never-installed clone" "$T/clone" "git commit -m x" \
  "CLAUDE_PROJECT_DIR=$T/clone"
run_in_env 2 "push in a never-installed clone" "$T/clone" "git push" \
  "CLAUDE_PROJECT_DIR=$T/clone"
run_in 0 "commit in a foreign repo" "$T/foreign" "git commit -m x"
run_in 0 "non-git command in an uninstalled worktree" "$T/wt" "ls -la"
run_in 0 "git status in an uninstalled worktree" "$T/wt" "git status"
run_in 0 "override waives the hooks-presence arm" "$T/wt" \
  "TZUROT_ALLOW_NO_VERIFY=1 git commit -m x"
run_in 2 "pushd into an uninstalled worktree" "$T/proj" "pushd $T/wt && git commit -m x"
run_in 2 "git -C into an uninstalled worktree for push" "$T/proj" "git -C $T/wt push"
run_in 2 "bash -c cd into an uninstalled worktree" "$T/proj" "bash -c 'cd $T/wt && git commit -m x'"
# The arm is off under GitHub Actions, read from the hook's own env only.
run_in_env 0 "GITHUB_ACTIONS=true in the hook env turns the arm off" "$T/wt" \
  "git commit -m x" GITHUB_ACTIONS=true
run_in 2 "a GITHUB_ACTIONS=true command prefix does not exempt" "$T/wt" \
  "GITHUB_ACTIONS=true git commit -m x"
# Fail-open claim: a git that errors on everything lets the command through.
run_in_env 0 "git failing for everything fails open" "$T/wt" "git commit -m x" \
  "PATH=$T/fakegit:$PATH"

BLOCK_ERR=$(jq -n --arg c "git commit -m x" --arg d "$T/wt" \
  '{tool_name:"Bash",cwd:$d,tool_input:{command:$c}}' \
  | CLAUDE_PROJECT_DIR="$T/proj" "$HOOK" 2>&1 >/dev/null)
if printf '%s' "$BLOCK_ERR" | grep -qF 'pnpm install --frozen-lockfile' \
  && printf '%s' "$BLOCK_ERR" | grep -qF "$T/wt"; then
  printf 'PASS  blocked commit prints the fix command and the checkout path\n'
else
  printf 'FAIL  fix command or path missing: %s\n' "$BLOCK_ERR"
  FAILURES=$((FAILURES + 1))
fi

if [ "$(printf '%s\n' "$BLOCK_ERR" | grep -c '^Checkout:')" = 1 ] \
  && printf '%s' "$BLOCK_ERR" | grep -qF 'pre-commit' \
  && printf '%s' "$BLOCK_ERR" | grep -qF 'commit-msg'; then
  printf 'PASS  a commit missing both hooks prints one Checkout block naming both\n'
else
  printf 'FAIL  expected one Checkout block naming both hooks: %s\n' "$BLOCK_ERR"
  FAILURES=$((FAILURES + 1))
fi

BYPASS_ERR=$(jq -n --arg c "TZUROT_ALLOW_NO_VERIFY=1 git commit -m x" --arg d "$T/wt" \
  '{tool_name:"Bash",cwd:$d,tool_input:{command:$c}}' \
  | CLAUDE_PROJECT_DIR="$T/proj" "$HOOK" 2>&1 >/dev/null)
if printf '%s' "$BYPASS_ERR" | grep -qF 'no-verify-guard: override used (git commit)'; then
  printf 'PASS  hooks-presence override prints its stderr line\n'
else
  printf 'FAIL  hooks-presence override stderr line missing: %s\n' "$BYPASS_ERR"
  FAILURES=$((FAILURES + 1))
fi

exit $FAILURES
