#!/bin/bash
# Fixture check for no-verify-guard.sh — run after ANY edit to the hook. The
# hook decides purely from the command text, so the harness needs no fixture
# repo, only the JSON payload shape the PreToolUse hook receives on stdin.
#
# Usage: .claude/hooks/no-verify-guard.probe.sh   (from anywhere)

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/no-verify-guard.sh"

FAILURES=0

# run <expected-exit> <label> <tool_name> <command>
run() {
  local expected="$1" label="$2" tool="$3" cmd="$4"
  jq -n --arg t "$tool" --arg c "$cmd" '{tool_name:$t,tool_input:{command:$c}}' \
    | "$HOOK" >/dev/null 2>&1
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
OVERRIDE_ERR=$(jq -n --arg c "TZUROT_ALLOW_NO_VERIFY=1 git push --no-verify" \
  '{tool_name:"Bash",tool_input:{command:$c}}' | "$HOOK" 2>&1 >/dev/null)
if printf '%s' "$OVERRIDE_ERR" | grep -qF 'no-verify-guard: override used (git push)'; then
  printf 'PASS  override prints its stderr line\n'
else
  printf 'FAIL  override stderr line missing: %s\n' "$OVERRIDE_ERR"
  FAILURES=$((FAILURES + 1))
fi

exit $FAILURES
