#!/bin/bash
# Fixture check for pr-merge-review-check.sh — run after ANY edit to the hook.
#
# This is the highest-stakes hook in the set: it is the structural backstop
# behind 00-critical's "read the review before merging" rule, and its silent
# failure mode is a merge proceeding UNREVIEWED. So the assertions here are on
# all three observable channels — the EXIT CODE (2 blocks the merge, 0 allows
# it), the injected stderr BLOCK (what the agent actually reads), and the ACK
# FILE (what makes the next attempt proceed).
#
# The assertion that matters most is none of those on its own: it is WHICH PR
# the hook decided to fetch. A wrong PR number whose review happens to be
# absent exits 0 and the merge lands unreviewed — an outcome indistinguishable
# from "correct PR, no review" if you only read the exit code. Every extraction
# case below therefore reads the PR number back out of the shimmed `gh api`
# call log rather than inferring it.
#
# Everything runs offline, with no production change to the hook:
#
#   * `gh` is shimmed onto the front of PATH — the base-branch lookup and the
#     review fetch are both driven from the fixture, and the fetch is logged so
#     the extracted PR number is readable.
#   * `id` is shimmed too. The ack path is `/tmp/.claude_pr_merge_ack.$(id -u)`
#     and `id` is a PATH lookup, so a fixture `id -u` redirects the ack file
#     with ZERO change to the hook. That is deliberate: an env-var override
#     would have added a bypass surface to the one hook whose whole job is to
#     be un-bypassable. Everything else `id` is asked for is passed through to
#     the real binary.
#
# The real ack file is checksummed before and after and asserted unchanged, so
# a shim that failed to take effect is reported rather than silently polluting
# the live gate.
#
# --- what this probe does NOT pin -------------------------------------------
#
#   1. The `--jq` output-shape contract. The `gh` shim dispatches on the
#      command text and returns a fixture that is ALREADY in post-`--jq` shape;
#      it never runs the real filter. So the hook's jq expressions are pinned
#      as far as "what does the script do with this shape" and not at all as
#      "does real `gh` produce this shape". Change the `--jq` to emit something
#      different and this probe keeps passing while the hook is broken against
#      real `gh`.
#   2. The pagination params (`per_page=100&direction=desc`). Their whole
#      purpose is to make the LAST claude[bot] comment the newest one on a busy
#      PR, which is a property of the live API, not of this fixture.
#   3. The known retarget gap the hook's own comment documents: a PR retargeted
#      develop→main between two attempts on the SAME review comment exits at the
#      ack fast path and never fires the release reminder. Deliberately not
#      pinned in either direction — pinning it as correct would make fixing it
#      a probe failure.
#   4. Whether stderr from a blocking PreToolUse hook actually reaches the
#      agent's context. That is a Claude Code runtime property; the probe can
#      only assert the hook wrote it.
#
# Three cases below are PINNED DEFECTS, labelled as such. The match tests the
# whole command TEXT, so any command carrying the phrase `gh pr merge` followed
# by a bare all-digit token arms the gate on the WRONG PR — whether that text is
# a decoy before a real invocation, a `--body` argument, or ordinary prose in an
# unrelated subcommand. They are pinned rather than fixed because hardening the
# match is a semantic change to the merge gate; pinning documents the boundary
# and makes the fix a deliberate act (update the cases) rather than an accident.
# The hardening is tracked as TASK-469.
#
# Usage: .claude/hooks/pr-merge-review-check.probe.sh   (from repo root)

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/pr-merge-review-check.sh"

FAILURES=0

if [ ! -f "$HOOK" ]; then
  printf 'FATAL: %s not found\n' "$HOOK" >&2
  exit 1
fi

WORK=$(mktemp -d)
ACK_PREFIX="/tmp/.claude_pr_merge_ack."
TOKEN_BASE="probe.$$"
# The redirected ack files live in /tmp beside the real one (the prefix is
# hard-coded in the hook and must stay that way), so they are cleaned by an
# explicit glob rather than by removing $WORK.
cleanup() {
  rm -rf "$WORK"
  rm -rf "${ACK_PREFIX}${TOKEN_BASE}."*
}
trap cleanup EXIT

# Leak guard: the live ack file must be byte-identical afterwards. Captured
# before the first invocation so an `id` shim that silently failed to take
# effect is caught, rather than quietly acking real PRs.
REAL_ACK="${ACK_PREFIX}$(id -u)"
# `md5sum` missing would make BOTH checksums fall through to the same sentinel,
# so the guard would compare "absent" to "absent" and report PASS having
# verified nothing — the vacuous pass this file refuses everywhere else. Checked
# once, up front, and fatal: a leak guard that cannot run is worse than none,
# because it reads as proof.
if ! command -v md5sum >/dev/null 2>&1; then
  printf 'FATAL: md5sum not found — the leak guard could not verify that the live\n' >&2
  printf 'ack file is untouched, and a guard that cannot run must not report a pass.\n' >&2
  exit 1
fi
# "absent" is a real state here, not a failure: the live ack file simply may not
# exist yet. Absent before and absent after is a correct pass; absent before and
# present after is the leak this guard exists to catch.
REAL_ACK_BEFORE=$(md5sum "$REAL_ACK" 2>/dev/null | cut -d' ' -f1 || echo "absent")

mkdir -p "$WORK/bin"

# --- the gh shim -----------------------------------------------------------
# Two calls to serve, both driven by env vars the cases set:
#   `gh pr view <n> --json baseRefName --jq ...`  -> the base branch
#   `gh api repos/.../issues/<n>/comments...`     -> the newest claude review
# The api call is LOGGED, because its URL carries the extracted PR number and
# that is the value the extraction cases assert on. Anything unrecognised exits
# 64 rather than succeeding silently — a shim that answers a call the hook does
# not make is how a probe ends up testing a path that no longer exists.
cat >"$WORK/bin/gh" <<'SHIM'
#!/bin/bash
case "$*" in
  *"--json baseRefName"*)
    [ "${SHIM_BASE_EXIT:-0}" = "0" ] || exit "${SHIM_BASE_EXIT}"
    printf '%s\n' "${SHIM_PR_BASE:-}"
    ;;
  *"/issues/"*"/comments"*)
    printf '%s\n' "$*" >>"${SHIM_API_LOG:-/dev/null}"
    printf '%s' "${SHIM_REVIEW_JSON:-}"
    ;;
  *)
    echo "gh shim: unexpected invocation: $*" >&2
    exit 64
    ;;
esac
SHIM
chmod +x "$WORK/bin/gh"

# --- the id shim -----------------------------------------------------------
# Only `id -u` is intercepted; everything else goes to the real binary so a
# future hook edit that asks `id` something different is not silently answered.
REAL_ID=$(command -v id)
write_id_shim() { # <token>
  cat >"$WORK/bin/id" <<SHIM
#!/bin/bash
if [ "\$#" -eq 1 ] && [ "\$1" = "-u" ]; then
  printf '%s\n' "$1"
  exit 0
fi
exec "$REAL_ID" "\$@"
SHIM
  chmod +x "$WORK/bin/id"
}

# --- driver ----------------------------------------------------------------
CASE_N=0
STDOUT_FILE=''
STDERR_FILE=''
API_LOG=''
ACK_FILE=''
LAST_EXIT=0

SHIM_PR_BASE='develop'
SHIM_BASE_EXIT=0
SHIM_REVIEW_JSON=''

# new_case — a fresh ack file, api log, and output captures. The ack file is
# the hook's only cross-invocation state, so a stale one leaking between groups
# would silently convert a "blocks" case into an "already acked" one.
new_case() {
  CASE_N=$((CASE_N + 1))
  TOKEN="${TOKEN_BASE}.${CASE_N}"
  ACK_FILE="${ACK_PREFIX}${TOKEN}"
  rm -rf "$ACK_FILE"
  write_id_shim "$TOKEN"
  API_LOG="$WORK/api.$CASE_N"
  STDOUT_FILE="$WORK/out.$CASE_N"
  STDERR_FILE="$WORK/err.$CASE_N"
  : >"$API_LOG"
}

payload() { jq -nc --arg c "$1" '{tool_name:"Bash",tool_input:{command:$c}}'; }

# invoke <command-string> — run the hook with the current shim env.
invoke() {
  printf '%s' "$(payload "$1")" | env \
    PATH="$WORK/bin:$PATH" \
    SHIM_API_LOG="$API_LOG" \
    SHIM_PR_BASE="$SHIM_PR_BASE" \
    SHIM_BASE_EXIT="$SHIM_BASE_EXIT" \
    SHIM_REVIEW_JSON="$SHIM_REVIEW_JSON" \
    bash "$HOOK" >"$STDOUT_FILE" 2>"$STDERR_FILE"
  LAST_EXIT=$?
}

# invoke_in <dir> <command-string> — same, with cwd redirected. Used only by
# the globbing case: `set -f` in the hook is about the CWD's contents, so the
# only way to prove it is to run somewhere that has a digit-named file in it.
invoke_in() {
  local dir="$1"
  (
    cd "$dir" || exit 1
    printf '%s' "$(payload "$2")" | env \
      PATH="$WORK/bin:$PATH" \
      SHIM_API_LOG="$API_LOG" \
      SHIM_PR_BASE="$SHIM_PR_BASE" \
      SHIM_BASE_EXIT="$SHIM_BASE_EXIT" \
      SHIM_REVIEW_JSON="$SHIM_REVIEW_JSON" \
      bash "$HOOK"
  ) >"$STDOUT_FILE" 2>"$STDERR_FILE"
  LAST_EXIT=$?
}

# review_json <id> <body> — a fixture already in post-`--jq` shape.
review_json() {
  jq -nc --arg i "$1" --arg b "$2" \
    '{id:($i|tonumber),created_at:"2026-08-08T12:00:00Z",body:$b}'
}

ok() { printf 'PASS  %s\n' "$1"; }
bad() {
  printf 'FAIL  %s\n' "$1"
  FAILURES=$((FAILURES + 1))
}

assert_exit() { # <label> <expected>
  if [ "$LAST_EXIT" = "$2" ]; then ok "$1"; else
    bad "$1 (exit $LAST_EXIT, expected $2)"
  fi
}

# assert_pr <label> <expected> — the load-bearing one. Reads the PR number back
# out of the URL the hook actually fetched, so "right PR" and "wrong PR that
# happened to exit the same way" are distinguishable.
extracted_pr() {
  sed -n 's#.*/issues/\([0-9][0-9]*\)/comments.*#\1#p' "$API_LOG" | tail -1
}
assert_pr() {
  local got
  got=$(extracted_pr)
  if [ "$got" = "$2" ]; then ok "$1"; else
    bad "$1 (fetched PR '${got:-<none>}', expected $2)"
  fi
}
assert_no_fetch() { # <label> — the hook exited before deciding on a PR at all
  if [ ! -s "$API_LOG" ]; then ok "$1"; else
    bad "$1 (expected no review fetch, got: $(tr '\n' ';' <"$API_LOG"))"
  fi
}

assert_silent() { # <label> — a clean no-op: nothing on either stream
  if [ -s "$STDERR_FILE" ]; then
    bad "$1 (expected silence, stderr: $(head -c 200 "$STDERR_FILE" | tr '\n' ';'))"
  elif [ -s "$STDOUT_FILE" ]; then
    bad "$1 (expected silence, stdout: $(head -c 200 "$STDOUT_FILE" | tr '\n' ';'))"
  else
    ok "$1"
  fi
}

assert_stderr_has() { # <label> <fixed-string>
  if grep -qF "$2" "$STDERR_FILE"; then ok "$1"; else
    bad "$1 (block missing: $2)"
  fi
}
assert_stderr_lacks() {
  if grep -qF "$2" "$STDERR_FILE"; then
    bad "$1 (block should NOT contain: $2)"
  else ok "$1"; fi
}
assert_ack_has() { # <label> <exact-line>
  if grep -qxF "$2" "$ACK_FILE" 2>/dev/null; then ok "$1"; else
    bad "$1 (ack missing line '$2'; holds: $(tr '\n' ';' <"$ACK_FILE" 2>/dev/null))"
  fi
}
assert_ack_lacks() {
  if grep -qxF "$2" "$ACK_FILE" 2>/dev/null; then
    bad "$1 (ack should not hold '$2')"
  else ok "$1"; fi
}

LGTM=$(review_json 777 'LGTM. No actionable findings.')

# ===========================================================================
# 1. Command match — the hook must not fire on anything that is not an actual
#    `gh pr merge`. Each of these would be a spurious block if it regressed.
# ===========================================================================
printf '\n--- command match (no block, no fetch) ---\n'

SHIM_REVIEW_JSON="$LGTM"

new_case
printf '{"tool_name":"Read","tool_input":{"file_path":"x"}}' | env \
  PATH="$WORK/bin:$PATH" SHIM_API_LOG="$API_LOG" \
  bash "$HOOK" >"$STDOUT_FILE" 2>"$STDERR_FILE"
LAST_EXIT=$?
assert_exit "non-Bash tool: allowed" 0
assert_no_fetch "non-Bash tool: no fetch"

new_case; invoke 'pnpm test'
assert_exit "unrelated command: allowed" 0
assert_no_fetch "unrelated command: no fetch"

# Both sides of the boundary. The trailing one is the case the hook's own
# comment calls out (`merge-queue`); the leading one is the half that is easy
# to drop when the regex is edited.
new_case; invoke 'gh pr merge-queue 2002'
assert_exit "trailing boundary: gh pr merge-queue is not gh pr merge" 0
assert_no_fetch "trailing boundary: no fetch"

new_case; invoke 'xgh pr merge 2002'
assert_exit "leading boundary: xgh pr merge is not gh pr merge" 0
assert_no_fetch "leading boundary: no fetch"

# `gh pr merge` with no number at all — the documented out-of-scope form.
new_case; invoke 'gh pr merge --rebase'
assert_exit "bare gh pr merge (no number): allowed" 0
assert_no_fetch "bare gh pr merge: no fetch"

# A digit that is part of a flag token, not a standalone argument. This is the
# distinction the `^[0-9]+$` test exists for.
new_case; invoke 'gh pr merge --retries=5 --rebase'
assert_exit "flag-value digit is not a PR number: allowed" 0
assert_no_fetch "flag-value digit: no fetch"

# ===========================================================================
# 2. PR-number extraction — asserted on the fetched URL, never on the exit code
# ===========================================================================
printf '\n--- PR-number extraction ---\n'

new_case; invoke 'gh pr merge 2002 --rebase'
assert_pr "number first" 2002

new_case; invoke 'gh pr merge --rebase 2002'
assert_pr "flags first" 2002

new_case; invoke 'gh  pr   merge  2002'
assert_pr "extra whitespace between words" 2002

# Every separator the leading boundary allows.
new_case; invoke 'pnpm test && gh pr merge 2002'
assert_pr "separator: &&" 2002
new_case; invoke 'echo done; gh pr merge 2002'
assert_pr "separator: ;" 2002
new_case; invoke 'true | gh pr merge 2002'
assert_pr "separator: pipe" 2002
new_case; invoke "$(printf 'pnpm test\ngh pr merge 2002')"
assert_pr "separator: newline" 2002

# The two-part precondition for the extraction defect, pinned as a pair: it
# takes a decoy gh/pr/merge sequence BEFORE the real invocation AND a bare
# all-digit token after it. Either half alone is harmless, and the difference
# between these cases is what documents the boundary.
new_case; invoke 'echo "gh pr merge 1" && gh pr merge 2002'
assert_pr "quoted decoy: the closing quote makes the token non-bare, so no misfire" 2002

new_case; invoke 'echo gh pr merge now && gh pr merge 2002'
assert_pr "leading decoy with no digit at all: no misfire" 2002

new_case; invoke 'gh pr merge 2002 && echo gh pr merge 1'
assert_pr "decoy AFTER the real invocation: no misfire" 2002

# PINNED DEFECT. Both halves of the precondition hold, and the hook extracts
# the decoy. Recorded so the boundary is documented and a fix is deliberate:
# when the extraction is hardened, this case flips to expect 2002.
new_case; invoke 'echo gh pr merge 1 && gh pr merge 2002'
assert_pr "PINNED DEFECT: unquoted leading decoy + bare digit wins over the real PR" 1

# PINNED DEFECT, wider than the decoy case above and measured rather than
# reasoned. The command match tests the whole command TEXT, so the subcommand
# actually being invoked is irrelevant: any Bash command whose text contains
# the phrase followed by a bare digit arms the gate. Prose ABOUT merging is
# enough — this fired in production twice, once on a read-only diagnostic and
# once on a reviewer's own `gh pr comment` submitting a review that quoted the
# hook's internals. It is pinned rather than fixed because hardening the match
# is a semantic change to the merge gate, tracked separately.
new_case; invoke 'gh pr comment 2006 --body "the hook matches gh pr merge 1 in prose"'
assert_pr "PINNED DEFECT: gh pr comment whose BODY quotes the phrase arms the gate" 1

new_case; invoke 'gh issue create --body "run gh pr merge 42 when ready"'
assert_pr "PINNED DEFECT: any command text carrying the phrase arms the gate" 42

# `set -f`. Without it the loop's unquoted expansion globs against the cwd, so
# a digit-named file becomes a PR number. Only reachable from a directory that
# actually holds one.
GLOBDIR="$WORK/globdir"
mkdir -p "$GLOBDIR"
: >"$GLOBDIR/7"
new_case; invoke_in "$GLOBDIR" 'gh pr merge * 2002'
assert_pr "set -f: a glob token does not expand into a digit-named file" 2002

# ===========================================================================
# 3. The review gate — block once per (PR, review-id), allow on retry
# ===========================================================================
printf '\n--- review gate: block, ack, retry ---\n'

SHIM_PR_BASE='develop'
new_case; SHIM_REVIEW_JSON="$LGTM"
invoke 'gh pr merge 2002 --rebase'
assert_exit "first call on a feature PR with a review: BLOCKS" 2
assert_stderr_has "block names the PR" 'PR MERGE GATE — latest claude-review for PR #2002'
assert_stderr_has "block carries the review body" 'LGTM. No actionable findings.'
assert_stderr_has "block carries the posted timestamp" 'Posted: 2026-08-08T12:00:00Z'
assert_stderr_has "block warns against editing the ack file" 'Do NOT bypass this gate by editing the ack file'
assert_ack_has "ack holds PR:review-id" '2002:777'
# `stat -c` is GNU syntax, so on a platform without it the mode is unreadable.
# That FAILS rather than skips, deliberately: an assertion that did not run must
# never report as one that passed, and this one covers the permissions of a file
# the merge gate trusts. The failure is the probe's own gap, not the hook's — the
# message says so, because the two send a reader at different files.
MODE=$(stat -c '%a' "$ACK_FILE" 2>/dev/null || echo '')
if [ -z "$MODE" ]; then
  bad "PROBE GAP (not a hook defect): could not read the ack file's mode — GNU \`stat -c\` unavailable? Failing rather than passing an assertion that never ran"
elif [ "$MODE" = "600" ]; then
  ok "ack file is mode 600"
else
  bad "ack file mode is $MODE, expected 600"
fi

invoke 'gh pr merge 2002 --rebase'
assert_exit "retry with the same review: ALLOWS" 0
assert_silent "retry is silent"

# Both halves of the ack key, varied independently. Same ack file throughout —
# that is the point: a key that dropped either half would let one of these
# through.
invoke 'gh pr merge 2003 --rebase'
assert_exit "different PR, same review-id: BLOCKS (PR half of the key)" 2
assert_pr "…and it fetched the other PR" 2003

SHIM_REVIEW_JSON=$(review_json 888 'Round 2: one finding.')
invoke 'gh pr merge 2002 --rebase'
assert_exit "same PR, NEW review-id: BLOCKS again (review half of the key)" 2
assert_stderr_has "…carrying the new review body" 'Round 2: one finding.'
assert_ack_has "ack now holds the new key too" '2002:888'
assert_ack_has "…and still holds the old one" '2002:777'

# Ack lookups are EXACT-line matches, and that is load-bearing rather than
# stylistic: relaxed to a substring match, a key that is a prefix of one
# already in the file reads as "already acked" and the merge proceeds with no
# review injected — the exact outcome this hook exists to prevent. The ack file
# accumulates across every PR the session touches, so a collision only needs
# two PR/review numbers where one pair's key is a prefix of another's.
new_case; SHIM_PR_BASE='develop'; SHIM_REVIEW_JSON=$(review_json 7770 'Review with the longer id.')
invoke 'gh pr merge 2002 --rebase'
assert_ack_has "ack holds the longer key" '2002:7770'
SHIM_REVIEW_JSON=$(review_json 777 'A DIFFERENT review whose key is a prefix of the acked one.')
invoke 'gh pr merge 2002 --rebase'
assert_exit "a key that is a PREFIX of an acked key still BLOCKS" 2
assert_stderr_has "…and injects its own review" 'A DIFFERENT review whose key is a prefix'

# Same property on the release key, which has its own lookup.
new_case; SHIM_PR_BASE='main'; SHIM_REVIEW_JSON=''
invoke 'gh pr merge 20100 --rebase'
assert_ack_has "release key acked for the longer PR number" 'RELEASE:20100'
invoke 'gh pr merge 2010 --rebase'
assert_exit "release PR whose key is a prefix of an acked one: still BLOCKS" 2
assert_stderr_has "…and still gets the reminder" 'RELEASE PR — base is main'

# ===========================================================================
# 4. No usable review — the gate has nothing to surface, so it allows
# ===========================================================================
printf '\n--- no usable review (feature PR) ---\n'

SHIM_PR_BASE='develop'

new_case; SHIM_REVIEW_JSON=''
invoke 'gh pr merge 2002 --rebase'
assert_exit "no claude-review comment: allowed" 0
assert_silent "no review: silent on a feature PR"

new_case; SHIM_REVIEW_JSON='null'
invoke 'gh pr merge 2002 --rebase'
assert_exit "jq returned the literal null: allowed" 0
assert_silent "literal null: silent"

new_case; SHIM_REVIEW_JSON=$(review_json 777 '')
invoke 'gh pr merge 2002 --rebase'
assert_exit "review comment with an empty body: allowed" 0
assert_silent "unparseable review: silent"

new_case; SHIM_REVIEW_JSON='{"created_at":"2026-08-08T12:00:00Z","body":"has a body but no id"}'
invoke 'gh pr merge 2002 --rebase'
assert_exit "review comment with no id: allowed" 0
assert_silent "missing id: silent"

# ===========================================================================
# 5. The release reminder — base=main, and reachable WITHOUT a review
# ===========================================================================
printf '\n--- release reminder (base=main) ---\n'

SHIM_PR_BASE='main'

new_case; SHIM_REVIEW_JSON="$LGTM"
invoke 'gh pr merge 2010 --rebase'
assert_exit "release PR with a review: BLOCKS" 2
assert_stderr_has "release block present" 'RELEASE PR — base is main'
assert_stderr_has "names the finalize command" 'pnpm ops release:finalize --yes'
assert_stderr_has "warns off --delete-branch" 'Do NOT pass --delete-branch'
assert_stderr_has "names the premigrate precondition" 'release:premigrate'
assert_ack_has "release key acked" 'RELEASE:2010'
assert_ack_has "review key acked too" '2010:777'

# A release PR whose claude-review posted NOTHING must still get the reminder.
# The review gate has nothing to say, but stderr only reaches the agent on the
# blocking path, so the hook exits 2 once anyway. This is the case that would
# silently regress if the reminder were moved back below the review-existence
# early-exits — which is where it used to sit.
new_case; SHIM_REVIEW_JSON=''
invoke 'gh pr merge 2010 --rebase'
assert_exit "release PR with NO review: still BLOCKS for the reminder" 2
assert_stderr_has "…and the reminder is there" 'RELEASE PR — base is main'
assert_stderr_has "…with the reason line naming the absent review" 'no claude-review comment found'
assert_ack_has "release key acked on the no-review path" 'RELEASE:2010'
invoke 'gh pr merge 2010 --rebase'
assert_exit "retry after the no-review reminder: allowed" 0
assert_silent "…and silent"

# The literal-null guard, which is invisible on a feature PR: without it the
# string "null" falls through to jq, produces an empty id, and lands on the
# OTHER no-usable-review exit — same exit code, same silence, different reason
# line. Only a release PR, where a reason line actually prints, can tell the
# two apart.
new_case; SHIM_REVIEW_JSON='null'
invoke 'gh pr merge 2010 --rebase'
assert_exit "release PR, jq returned literal null: BLOCKS for the reminder" 2
assert_stderr_has "…reported as an ABSENT review, not an unparseable one" 'no claude-review comment found'
assert_stderr_lacks "…and not as a parse failure" 'did not parse'

# The two no-usable-review exits are NOT the same state, and the hook says
# which. A single shared wording would be a banner asserting something untrue.
new_case; SHIM_REVIEW_JSON=$(review_json 777 '')
invoke 'gh pr merge 2010 --rebase'
assert_exit "release PR with an unparseable review: BLOCKS" 2
assert_stderr_has "…with its own distinct reason line" 'did not parse'

# The reminder is once per PR, not once per review round.
new_case; SHIM_REVIEW_JSON="$LGTM"
invoke 'gh pr merge 2010 --rebase'
assert_stderr_has "first block on the release PR carries the reminder" 'RELEASE PR — base is main'
SHIM_REVIEW_JSON=$(review_json 888 'Round 2 on the release PR.')
invoke 'gh pr merge 2010 --rebase'
assert_exit "a fresh review re-arms the review gate" 2
assert_stderr_has "…and injects the new review" 'Round 2 on the release PR.'
assert_stderr_lacks "…but does NOT repeat the release reminder" 'RELEASE PR — base is main'

# Fail-open on an unreadable base: no reminder, never a hard block.
new_case; SHIM_PR_BASE=''; SHIM_BASE_EXIT=1; SHIM_REVIEW_JSON=''
invoke 'gh pr merge 2010 --rebase'
assert_exit "gh pr view fails: no reminder, merge allowed" 0
assert_silent "unreadable base is silent, not a block"
SHIM_BASE_EXIT=0

# A feature PR never gets the release block, review or not.
new_case; SHIM_PR_BASE='develop'; SHIM_REVIEW_JSON="$LGTM"
invoke 'gh pr merge 2002 --rebase'
assert_stderr_lacks "feature PR gets no release block" 'RELEASE PR — base is main'
assert_ack_lacks "…and no release ack key" 'RELEASE:2002'

# ===========================================================================
# 6. Origin-language scan
# ===========================================================================
printf '\n--- origin-language scan ---\n'

SHIM_PR_BASE='develop'

new_case; SHIM_REVIEW_JSON=$(review_json 777 'This is pre-existing and not a regression.')
invoke 'gh pr merge 2002 --rebase'
assert_stderr_has "origin language fires" 'ORIGIN-LANGUAGE DETECTED'
assert_stderr_has "…and demands a merits disposition" 'merits disposition'

# The count is reported, not just the boolean — the warning says how much of it
# there is, so a regression to a plain flag would still print the banner.
new_case; SHIM_REVIEW_JSON=$(review_json 777 "$(printf 'line one predates the change\nline two is consistent with existing code\n')")
invoke 'gh pr merge 2002 --rebase'
assert_stderr_has "origin count is per-line" 'DETECTED (2 matching line(s))'

new_case; SHIM_REVIEW_JSON=$(review_json 777 'Two real findings, both introduced here.')
invoke 'gh pr merge 2002 --rebase'
assert_stderr_lacks "clean review: no origin warning" 'ORIGIN-LANGUAGE DETECTED'

# ===========================================================================
# 7. Body fidelity — the printf-not-heredoc decision
# ===========================================================================
printf '\n--- injected body fidelity ---\n'

# A review quoting a heredoc would truncate the injection under an unquoted
# heredoc; printf has no delimiter semantics. The tail line proves nothing was
# cut, which a leading-line assertion could not.
new_case; SHIM_REVIEW_JSON=$(review_json 777 "$(printf 'before the delimiter\nEOF\nafter the delimiter')")
invoke 'gh pr merge 2002 --rebase'
assert_stderr_has "body containing a bare EOF line: head survives" 'before the delimiter'
assert_stderr_has "…and the tail past it survives too" 'after the delimiter'

# ===========================================================================
# 8. Fail-open when the ack write itself fails
# ===========================================================================
printf '\n--- ack-write failure is fail-open ---\n'

# Blocking forever would be the worse failure: the next call would also fail to
# write, never see an ack, and re-block. A directory at the ack path makes the
# append fail without touching anything else.
new_case; SHIM_PR_BASE='develop'; SHIM_REVIEW_JSON="$LGTM"
rm -rf "$ACK_FILE"; mkdir -p "$ACK_FILE"
invoke 'gh pr merge 2002 --rebase'
assert_exit "review path, unwritable ack: allows rather than blocking forever" 0
assert_stderr_has "…and says why" 'ack write failed'
assert_stderr_has "…after injecting the review anyway" 'LGTM. No actionable findings.'

new_case; SHIM_PR_BASE='main'; SHIM_REVIEW_JSON=''
rm -rf "$ACK_FILE"; mkdir -p "$ACK_FILE"
invoke 'gh pr merge 2010 --rebase'
assert_exit "release path, unwritable ack: allows" 0
assert_stderr_has "…and says why" 'release-reminder ack write failed'

# ===========================================================================
# 9. Leak guard — the live ack file must be untouched
# ===========================================================================
printf '\n--- leak guard ---\n'

REAL_ACK_AFTER=$(md5sum "$REAL_ACK" 2>/dev/null | cut -d' ' -f1 || echo "absent")
if [ "$REAL_ACK_BEFORE" = "$REAL_ACK_AFTER" ]; then
  ok "the live ack file is unchanged ($REAL_ACK_BEFORE)"
else
  bad "the live ack file CHANGED ($REAL_ACK_BEFORE -> $REAL_ACK_AFTER) — the id shim did not hold"
fi

if [ "$FAILURES" -gt 0 ]; then
  printf '\n%d probe(s) FAILED\n' "$FAILURES" >&2
  exit 1
fi
printf '\nAll probes passed\n'
