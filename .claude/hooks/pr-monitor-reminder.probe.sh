#!/bin/bash
# Fixture check for pr-monitor-reminder.sh — run after ANY edit to the hook.
#
# The hook exits 0 on every path, so its exit code carries no information: the
# assertions here are on OUTPUT (does the banner print, and does it carry the
# lines that make it usable) and on SIDE EFFECTS (does the assignee backfill
# call the API, does the dedup ledger get written). A probe asserting only exit
# codes would pass against a hook that had stopped emitting anything at all.
#
# Everything runs offline. `gh` is shimmed onto the front of PATH, so PR-number
# resolution, the assignee lookup, and the backfill write are all driven from
# the fixture rather than the network. `git` stays real for most cases — the
# hook only asks it for the current branch and HEAD, which the repo already
# answers — with ONE exception: the SHA-axis dedup group runs the hook inside a
# throwaway repo under $WORK, because the ledger key is (PR, SHA) and proving
# the SHA half needs a HEAD that MOVES. Moving the real checkout's HEAD is
# precisely the side effect this probe must not have. The
# dedup ledger is redirected via TZUROT_PR_MONITOR_SEEN_FILE — without that,
# the first run would write the live key and every later run would early-exit
# at the dedup check, leaving the probe silently inert while still exiting 0.
#
# The banner assertions matter more than they look. The hook's own header warns
# at length that the Monitor line must print `$(git rev-parse HEAD)` UNRESOLVED
# — a hand-transcribed SHA failed four times in one session, and a resolved one
# would also break `guard:monitor-command`, which requires this copy to match
# the two doc copies. That is pinned below as its own case.
#
# Usage: .claude/hooks/pr-monitor-reminder.probe.sh   (from repo root)

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/pr-monitor-reminder.sh"

FAILURES=0

if [ ! -f "$HOOK" ]; then
  printf 'FATAL: %s not found\n' "$HOOK" >&2
  exit 1
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# --- the gh shim -----------------------------------------------------------
# Behaviour is driven by env vars the cases set, so one shim covers every
# branch. Anything unrecognised exits non-zero rather than silently succeeding
# — a shim that answers a call the hook did not make is how a probe ends up
# testing a path that no longer exists.
mkdir -p "$WORK/bin"
cat >"$WORK/bin/gh" <<'SHIM'
#!/bin/bash
case "$1 $2" in
  "pr list")
    printf '%s\n' "${SHIM_PR_LIST:-}"
    ;;
  "pr view")
    [ -n "${SHIM_PR_VIEW:-}" ] || exit 1
    printf '%s\n' "$SHIM_PR_VIEW"
    ;;
  "api "*)
    printf '%s\n' "$*" >>"${SHIM_API_LOG:-/dev/null}"
    exit "${SHIM_API_EXIT:-0}"
    ;;
  *)
    echo "gh shim: unexpected invocation: $*" >&2
    exit 64
    ;;
esac
SHIM
chmod +x "$WORK/bin/gh"

# --- driver ----------------------------------------------------------------
# Each case gets a fresh ledger and API log so nothing leaks between them.
CASE_N=0
STDOUT_FILE=''
STDERR_FILE=''
API_LOG=''
SEEN_FILE=''

# invoke <payload-json>  [env assignments are inherited from the caller]
invoke() {
  local payload="$1"
  printf '%s' "$payload" | env \
    PATH="$WORK/bin:$PATH" \
    TZUROT_PR_MONITOR_SEEN_FILE="$SEEN_FILE" \
    SHIM_API_LOG="$API_LOG" \
    SHIM_PR_LIST="${SHIM_PR_LIST:-}" \
    SHIM_PR_VIEW="${SHIM_PR_VIEW:-}" \
    SHIM_API_EXIT="${SHIM_API_EXIT:-0}" \
    bash "$HOOK" >"$STDOUT_FILE" 2>"$STDERR_FILE"
}

# invoke_in <dir> <payload-json> — same, but with the hook's cwd redirected.
# Used only by the SHA-axis group: the hook reads HEAD from cwd, so a throwaway
# repo is what lets the SHA vary without touching the real checkout.
invoke_in() {
  local dir="$1" payload="$2"
  (
    cd "$dir" || exit 1
    printf '%s' "$payload" | env \
      PATH="$WORK/bin:$PATH" \
      TZUROT_PR_MONITOR_SEEN_FILE="$SEEN_FILE" \
      SHIM_API_LOG="$API_LOG" \
      SHIM_PR_LIST="${SHIM_PR_LIST:-}" \
      SHIM_PR_VIEW="${SHIM_PR_VIEW:-}" \
      SHIM_API_EXIT="${SHIM_API_EXIT:-0}" \
      bash "$HOOK"
  ) >"$STDOUT_FILE" 2>"$STDERR_FILE"
}

# new_case — fresh ledger + API log for the next assertion group
new_case() {
  CASE_N=$((CASE_N + 1))
  SEEN_FILE="$WORK/seen.$CASE_N"
  API_LOG="$WORK/api.$CASE_N"
  STDOUT_FILE="$WORK/out.$CASE_N"
  STDERR_FILE="$WORK/err.$CASE_N"
  : >"$API_LOG"
}

ok() { printf 'PASS  %s\n' "$1"; }
bad() {
  printf 'FAIL  %s\n' "$1"
  FAILURES=$((FAILURES + 1))
}

# assert_silent <label> — the hook produced no banner AND no diagnostics.
# stderr is included because an early-exit path that started leaking a stray
# line would otherwise pass here: the banner is what the agent sees, but a
# diagnostic on a path that is supposed to be a clean no-op is still a
# regression, and stdout-only would call it silent.
assert_silent() {
  if [ -s "$STDOUT_FILE" ]; then
    bad "$1 (expected no banner, got $(wc -l <"$STDOUT_FILE") lines)"
  elif [ -s "$STDERR_FILE" ]; then
    bad "$1 (no banner, but stderr: $(tr '\n' ';' <"$STDERR_FILE"))"
  else
    ok "$1"
  fi
}

# assert_banner <label> <pr-number>
assert_banner() {
  if grep -q "PR #$2" "$STDOUT_FILE"; then ok "$1"; else
    bad "$1 (expected a banner naming PR #$2)"
  fi
}

# assert_stdout_has <label> <fixed-string>
assert_stdout_has() {
  if grep -qF "$2" "$STDOUT_FILE"; then ok "$1"; else
    bad "$1 (banner missing: $2)"
  fi
}

# assert_api_called / assert_api_quiet
assert_api_called() {
  if grep -qF "$2" "$API_LOG"; then ok "$1"; else
    bad "$1 (no matching gh api call; log: $(tr '\n' ';' <"$API_LOG"))"
  fi
}
assert_api_quiet() {
  if [ ! -s "$API_LOG" ]; then ok "$1"; else
    bad "$1 (expected no gh api call, got: $(tr '\n' ';' <"$API_LOG"))"
  fi
}

# payload builders
bash_payload() { jq -nc --arg c "$1" '{tool_name:"Bash",tool_input:{command:$c}}'; }
create_payload() {
  jq -nc --arg c "$1" --arg o "$2" \
    '{tool_name:"Bash",tool_input:{command:$c},tool_response:{output:$o}}'
}
# The hook reads the PR URL through a three-candidate fallback chain
# (`.tool_result.stdout // .tool_response.output // .output`) because the
# PostToolUse payload shape is not documented — its own comment calls this
# "field-path guesswork" pending observability. Guesswork is exactly what a
# probe should pin: each candidate gets a builder so all three are exercised,
# and whichever one turns out to be real keeps working when the other two are
# eventually deleted.
create_payload_result_stdout() {
  jq -nc --arg c "$1" --arg o "$2" \
    '{tool_name:"Bash",tool_input:{command:$c},tool_result:{stdout:$o}}'
}
create_payload_bare_output() {
  jq -nc --arg c "$1" --arg o "$2" \
    '{tool_name:"Bash",tool_input:{command:$c},output:$o}'
}

# ===========================================================================
# 1. Early exits — the hook must stay silent on anything that is not a
#    PR-bearing push. Each of these would be a spurious banner if it regressed.
# ===========================================================================
printf '\n--- early exits (no banner) ---\n'

new_case; SHIM_PR_LIST='2004'
printf '{"tool_name":"Read","tool_input":{"file_path":"x"}}' | env \
  PATH="$WORK/bin:$PATH" TZUROT_PR_MONITOR_SEEN_FILE="$SEEN_FILE" \
  bash "$HOOK" >"$STDOUT_FILE" 2>"$STDERR_FILE"
assert_silent "non-Bash tool"

new_case; SHIM_PR_LIST='2004'
invoke "$(bash_payload 'pnpm test')"
assert_silent "unrelated command"

new_case; SHIM_PR_LIST='2004'
invoke "$(bash_payload 'git status')"
assert_silent "git command that is not a push"

# The command match is bounded on both sides of BOTH alternatives, so all four
# corners are pinned: `git push-custom` / `gh pr createfoo` for the trailing
# boundary, `mygit push` / `xgh pr create` for the leading one. The asymmetry is
# what lets an edit to one side of the regex regress unnoticed — and it is easy
# to half-close, which is how this comment first shipped claiming both sides
# while only `git push` had both.
new_case; SHIM_PR_LIST='2004'
invoke "$(bash_payload 'git push-custom origin develop')"
assert_silent "trailing boundary: git push-custom is not git push"

new_case; SHIM_PR_LIST='2004'
invoke "$(bash_payload 'mygit push origin develop')"
assert_silent "leading boundary: mygit push is not git push"

new_case; SHIM_PR_LIST='2004'
invoke "$(bash_payload 'xgh pr create --base develop')"
assert_silent "leading boundary: xgh pr create is not gh pr create"

new_case; SHIM_PR_LIST='2004'
invoke "$(bash_payload 'gh pr createfoo --base develop')"
assert_silent "trailing boundary: gh pr createfoo is not gh pr create"

# Tag pushes carry no PR association even when the branch happens to have one.
new_case; SHIM_PR_LIST='2004'
invoke "$(bash_payload 'git push --tags')"
assert_silent "git push --tags"
new_case; SHIM_PR_LIST='2004'
invoke "$(bash_payload 'git push origin --tags')"
assert_silent "git push origin --tags"

# No open PR for the branch: the common case on a develop/main push or a
# feature branch whose PR is not open yet. Both the empty and the literal
# "null" jq output must exit silently.
new_case; SHIM_PR_LIST=''
invoke "$(bash_payload 'git push')"
assert_silent "branch has no open PR"
new_case; SHIM_PR_LIST='null'
invoke "$(bash_payload 'git push')"
assert_silent "gh returned the literal null"

# ===========================================================================
# 2. PR-number resolution — the two paths, and that they agree
# ===========================================================================
printf '\n--- PR-number resolution ---\n'

# `gh pr create` parses the PR URL out of the tool output, avoiding the
# replication lag `gh pr list` hits immediately after creation. The list shim
# returns a DIFFERENT number here so the assertion proves the stdout path won
# rather than merely that some number was found.
new_case; SHIM_PR_LIST='1111'; SHIM_PR_VIEW=''
invoke "$(create_payload 'gh pr create --base develop' 'https://github.com/lbds137/tzurot/pull/2004')"
assert_banner "gh pr create: number comes from the URL, not the list fallback" 2004

# The other two candidates in the same fallback chain. The list shim still
# returns 1111, so each of these proves ITS field was read rather than the
# fallback firing.
new_case; SHIM_PR_LIST='1111'; SHIM_PR_VIEW=''
invoke "$(create_payload_result_stdout 'gh pr create --base develop' 'https://github.com/lbds137/tzurot/pull/2004')"
assert_banner "gh pr create: reads .tool_result.stdout" 2004

new_case; SHIM_PR_LIST='1111'; SHIM_PR_VIEW=''
invoke "$(create_payload_bare_output 'gh pr create --base develop' 'https://github.com/lbds137/tzurot/pull/2004')"
assert_banner "gh pr create: reads the bare .output" 2004

# When the payload carries no usable output, the hook falls through to the
# branch lookup and says so on stderr — that line is the drift detector for
# the payload-shape guesswork, so it is pinned.
new_case; SHIM_PR_LIST='1234'; SHIM_PR_VIEW=''
invoke "$(bash_payload 'gh pr create --base develop')"
assert_banner "gh pr create with no output: falls back to the branch lookup" 1234
if grep -q 'falling back to gh pr list' "$STDERR_FILE"; then
  ok "fallback is announced on stderr"
else
  bad "fallback should announce itself on stderr"
fi

new_case; SHIM_PR_LIST='2004'; SHIM_PR_VIEW=''
invoke "$(bash_payload 'git push -u origin feat/x')"
assert_banner "git push: number comes from the branch lookup" 2004

# Command-position variants: the match allows the command to sit after a
# separator, so a chained push still resolves.
new_case; SHIM_PR_LIST='2004'; SHIM_PR_VIEW=''
invoke "$(bash_payload 'pnpm test && git push')"
assert_banner "chained: pnpm test && git push" 2004

# ===========================================================================
# 3. Dedup ledger — one banner per (PR, SHA)
# ===========================================================================
printf '\n--- dedup ledger ---\n'

new_case; SHIM_PR_LIST='2004'; SHIM_PR_VIEW=''
invoke "$(bash_payload 'git push')"
assert_banner "first push for this (PR, SHA) prints" 2004
if [ -s "$SEEN_FILE" ]; then ok "ledger written"; else bad "ledger should be written"; fi
# The ledger holds PR/SHA history, not a secret — but the hook restricts it
# anyway, and a regression there is invisible without an assertion.
MODE=$(stat -c '%a' "$SEEN_FILE" 2>/dev/null || echo '?')
if [ "$MODE" = "600" ]; then ok "ledger is mode 600"; else bad "ledger mode is $MODE, expected 600"; fi

# Same ledger, second invocation: must stay silent.
invoke "$(bash_payload 'git push')"
assert_silent "second push at the same SHA is deduped"

# A DIFFERENT PR at the same SHA is a different key and must still print —
# this is what makes the ledger append-only-per-pair rather than per-SHA, and
# it is what keeps multi-PR sessions working.
SHIM_PR_LIST='2005'
invoke "$(bash_payload 'git push')"
assert_banner "a different PR at the same SHA still prints" 2005

# The SHA half of the key, which the cases above cannot reach: they all run in
# the real checkout, so HEAD is constant and only the PR varies. The scenario
# the dedup exists FOR is the opposite one — a new commit pushed to the same
# open PR, which happens on every round of a review cycle and must print again.
# A throwaway repo supplies a HEAD that can move without touching the real
# checkout, which is the side effect this probe is built to avoid.
printf '\n--- dedup ledger: the SHA axis ---\n'

TINY="$WORK/repo"
git init -q "$TINY" 2>/dev/null
git -C "$TINY" -c user.email=probe@example.invalid -c user.name=probe \
  commit -q --allow-empty -m first 2>/dev/null
SHA_A=$(git -C "$TINY" rev-parse HEAD 2>/dev/null || echo "")

new_case; SHIM_PR_LIST='2004'; SHIM_PR_VIEW=''
invoke_in "$TINY" "$(bash_payload 'git push')"
assert_banner "throwaway repo, first commit: prints" 2004
invoke_in "$TINY" "$(bash_payload 'git push')"
assert_silent "same commit again: deduped"

git -C "$TINY" -c user.email=probe@example.invalid -c user.name=probe \
  commit -q --allow-empty -m second 2>/dev/null
SHA_B=$(git -C "$TINY" rev-parse HEAD 2>/dev/null || echo "")

# Guard the fixture itself: if HEAD did not actually move, the assertion below
# would pass for the wrong reason — it would be re-testing the same key rather
# than a new one, and would keep passing against a hook that had dropped SHA
# from the key entirely.
if [ -n "$SHA_A" ] && [ -n "$SHA_B" ] && [ "$SHA_A" != "$SHA_B" ]; then
  ok "fixture moved HEAD (${SHA_A:0:8} → ${SHA_B:0:8})"
else
  bad "fixture did not move HEAD — the SHA-axis case below proves nothing"
fi

invoke_in "$TINY" "$(bash_payload 'git push')"
assert_banner "same PR at a NEW commit: prints again" 2004
invoke_in "$TINY" "$(bash_payload 'git push')"
assert_silent "the new commit is deduped in turn"

# ===========================================================================
# 4. Assignee backfill — the one effect that does not depend on delivery
# ===========================================================================
printf '\n--- assignee backfill ---\n'

new_case; SHIM_PR_LIST='2004'; SHIM_PR_VIEW='lbds137 0'
invoke "$(bash_payload 'git push')"
assert_api_called "unassigned human PR: backfills the author" 'assignees[]=lbds137'
# The failure path's announcement is asserted below; assert the success one too.
# The API call is the effect that matters, but a silent success is how "did the
# backfill run?" becomes unanswerable after the fact — and the asymmetry alone
# would eventually read as "the success line was deliberately not required".
if grep -q 'auto-assigned lbds137 to PR #2004' "$STDERR_FILE"; then
  ok "successful backfill announces itself"
else
  bad "successful backfill should announce itself on stderr"
fi

new_case; SHIM_PR_LIST='2004'; SHIM_PR_VIEW='lbds137 1'
invoke "$(bash_payload 'git push')"
assert_api_quiet "already-assigned PR: no API call"

# Owner policy: bot PRs stay unassigned. Both the bare and the app/-prefixed
# login shapes are skipped.
new_case; SHIM_PR_LIST='2004'; SHIM_PR_VIEW='dependabot[bot] 0'
invoke "$(bash_payload 'git push')"
assert_api_quiet "dependabot PR: no API call"
new_case; SHIM_PR_LIST='2004'; SHIM_PR_VIEW='app/dependabot 0'
invoke "$(bash_payload 'git push')"
assert_api_quiet "app/dependabot PR: no API call"

# Input hygiene: a login carrying anything outside [A-Za-z0-9-] never reaches
# the API call. Real GitHub logins cannot contain these.
new_case; SHIM_PR_LIST='2004'; SHIM_PR_VIEW='foo;rm -rf / 0'
invoke "$(bash_payload 'git push')"
assert_api_quiet "mangled login: no API call"

# Fail-open: `gh pr view` unavailable (offline) must not suppress the banner.
new_case; SHIM_PR_LIST='2004'; SHIM_PR_VIEW=''
invoke "$(bash_payload 'git push')"
assert_banner "gh pr view unavailable: banner still prints" 2004

# A failed backfill is fail-open too, but must SAY so — a silent permission
# error would read as "the backfill never runs".
new_case; SHIM_PR_LIST='2004'; SHIM_PR_VIEW='lbds137 0'; SHIM_API_EXIT=1
invoke "$(bash_payload 'git push')"
assert_banner "failed backfill: banner still prints" 2004
if grep -q 'assignee backfill failed' "$STDERR_FILE"; then
  ok "failed backfill announces itself"
else
  bad "failed backfill should announce itself on stderr"
fi
SHIM_API_EXIT=0

# ===========================================================================
# 5. Banner content — the lines that make it actionable
# ===========================================================================
printf '\n--- banner content ---\n'

new_case; SHIM_PR_LIST='2004'; SHIM_PR_VIEW=''
invoke "$(bash_payload 'git push')"

# THE load-bearing assertion. The substitution must print UNRESOLVED: a baked
# SHA has to be transcribed from somewhere, which failed four times in one
# session and spins silently rather than erroring — and it would also break
# guard:monitor-command, which requires this copy to match the two doc copies
# modulo the PR/SHA placeholders.
assert_stdout_has "monitor command prints the substitution unresolved" \
  'pnpm ops gh:ci-gate 2004 --sha $(git rev-parse HEAD)'
if grep -qE 'gh:ci-gate 2004 --sha [0-9a-f]{7,40}' "$STDOUT_FILE"; then
  bad "monitor command has a RESOLVED sha baked in"
else
  ok "monitor command has no resolved sha"
fi

# The stop-the-previous-monitor instruction: one monitor per PR is the whole
# reason a stale watcher does not report the current state under an old label.
assert_stdout_has "banner says to stop a previous monitor" 'TaskStop'
# persistent:false is a deliberate departure from the Monitor tool's own
# guidance; the banner has to carry it or the reader will "correct" it back.
assert_stdout_has "banner names persistent false" 'persistent false'
assert_stdout_has "banner names the 30-min timeout" '1800000'
# All three review endpoints — the issue-comments call alone silently misses
# inline line comments, which is where blocking feedback usually lands.
assert_stdout_has "banner names gh:pr-comments" 'gh:pr-comments 2004'
assert_stdout_has "banner names gh:pr-reviews" 'gh:pr-reviews 2004'
assert_stdout_has "banner names gh:pr-info" 'gh:pr-info 2004'
assert_stdout_has "banner names the review-response skill" '/tzurot-review-response'

if [ "$FAILURES" -gt 0 ]; then
  printf '\n%d probe(s) FAILED\n' "$FAILURES" >&2
  exit 1
fi
printf '\nAll probes passed\n'
