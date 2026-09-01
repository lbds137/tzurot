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
#   3. Whether stderr from a blocking PreToolUse hook actually reaches the
#      agent's context. That is a Claude Code runtime property; the probe can
#      only assert the hook wrote it.
#
# Three cases in section 2 were PINNED DEFECTS until the extraction was
# rewritten: the old match tested the whole command TEXT, so any
# command carrying the phrase `gh pr merge` plus a bare all-digit token armed
# the gate on the WRONG PR — a decoy before the real invocation, a `--body`
# argument, or prose in an unrelated subcommand. They now assert the correct
# behaviour, which is what pinning them was for: the fix flipped known cases
# instead of discovering them.
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
    # Post-`--jq` shape for `(.baseRefName // ""), (.headRefName // "")`: one
    # ref per line, base first. A missing head is an EMPTY second line, not an
    # absent one — that is what the hook's `sed -n 2p` reads.
    printf '%s\n%s\n' "${SHIM_PR_BASE:-}" "${SHIM_PR_HEAD:-}"
    ;;
  *"/issues/"*"/comments"*)
    printf '%s\n' "$*" >>"${SHIM_API_LOG:-/dev/null}"
    printf '%s' "${SHIM_REVIEW_JSON:-}"
    ;;
  "pr diff "*)
    # The added-comment claim scan's input. SHIM_DIFF_EXIT non-zero with no
    # output is the fail-open case: the hook must degrade to "no scan", never
    # to a warning or a block.
    [ "${SHIM_DIFF_EXIT:-0}" = "0" ] || exit "${SHIM_DIFF_EXIT}"
    printf '%s' "${SHIM_PR_DIFF:-}"
    ;;
  *)
    echo "gh shim: unexpected invocation: $*" >&2
    exit 64
    ;;
esac
SHIM
chmod +x "$WORK/bin/gh"

# --- the git shim ----------------------------------------------------------
# The delete-branch guard asks git two questions: which worktree am I in, and
# which worktrees hold which branches. Both are shimmed so the cases can pose a
# worktree layout that does not exist on this machine.
#
# The DEFAULT is an empty worktree list, not the real repo's. A probe that fell
# through to real git would answer from whatever branches happen to be checked
# out while it runs — so it would pass on this laptop and fail on the next one,
# and the fixture cases would silently depend on the developer's tree.
#
# `SHIM_GIT_EXIT` makes both queries fail, which is how the fail-open case
# proves the guard degrades to "allow" rather than "cannot merge".
cat >"$WORK/bin/git" <<'SHIM'
#!/bin/bash
[ "${SHIM_GIT_EXIT:-0}" = "0" ] || exit "${SHIM_GIT_EXIT}"
# Separate knob so `worktree list` can fail while `rev-parse` succeeds. The
# combined SHIM_GIT_EXIT short-circuits on the empty-CURRENT_TREE check and
# never reaches the worktree query, so it cannot cover that asymmetry.
case "$*" in
  "worktree list --porcelain")
    [ "${SHIM_WORKTREE_EXIT:-0}" = "0" ] || exit "${SHIM_WORKTREE_EXIT}" ;;
esac
case "$*" in
  # `${VAR-default}`, NOT `${VAR:-default}`: the colon form substitutes on an
  # EMPTY value too, so a case setting SHIM_CURRENT_TREE='' to simulate a failed
  # `rev-parse` would silently get `/repo` back and test nothing.
  "rev-parse --show-toplevel") printf '%s\n' "${SHIM_CURRENT_TREE-/repo}" ;;
  "worktree list --porcelain") printf '%s' "${SHIM_WORKTREES:-}" ;;
  *) echo "git shim: unexpected invocation: $*" >&2; exit 64 ;;
esac
SHIM
chmod +x "$WORK/bin/git"

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
SHIM_PR_HEAD='feat/example'
SHIM_BASE_EXIT=0
SHIM_REVIEW_JSON=''
SHIM_CURRENT_TREE='/repo'
SHIM_WORKTREES=''
SHIM_GIT_EXIT=0
SHIM_WORKTREE_EXIT=0
SHIM_PR_DIFF=''
SHIM_DIFF_EXIT=0

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
    SHIM_PR_HEAD="$SHIM_PR_HEAD" \
    SHIM_BASE_EXIT="$SHIM_BASE_EXIT" \
    SHIM_REVIEW_JSON="$SHIM_REVIEW_JSON" \
    SHIM_CURRENT_TREE="$SHIM_CURRENT_TREE" \
    SHIM_WORKTREES="$SHIM_WORKTREES" \
    SHIM_GIT_EXIT="$SHIM_GIT_EXIT" \
    SHIM_WORKTREE_EXIT="$SHIM_WORKTREE_EXIT" \
    SHIM_PR_DIFF="$SHIM_PR_DIFF" \
    SHIM_DIFF_EXIT="$SHIM_DIFF_EXIT" \
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
      SHIM_PR_HEAD="$SHIM_PR_HEAD" \
      SHIM_BASE_EXIT="$SHIM_BASE_EXIT" \
      SHIM_REVIEW_JSON="$SHIM_REVIEW_JSON" \
      SHIM_CURRENT_TREE="$SHIM_CURRENT_TREE" \
      SHIM_WORKTREES="$SHIM_WORKTREES" \
      SHIM_GIT_EXIT="$SHIM_GIT_EXIT" \
      SHIM_WORKTREE_EXIT="$SHIM_WORKTREE_EXIT" \
      SHIM_PR_DIFF="$SHIM_PR_DIFF" \
      SHIM_DIFF_EXIT="$SHIM_DIFF_EXIT" \
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

# The two-part precondition for the old extraction defect, kept as a group
# because the differences between these cases are what document the boundary.
new_case; invoke 'echo "gh pr merge 1" && gh pr merge 2002'
assert_pr "quoted decoy: no misfire" 2002

new_case; invoke 'echo gh pr merge now && gh pr merge 2002'
assert_pr "leading decoy with no digit at all: no misfire" 2002

new_case; invoke 'gh pr merge 2002 && echo gh pr merge 1'
assert_pr "decoy AFTER the real invocation: no misfire" 2002

# WAS A PINNED DEFECT. The old text scan stripped to the FIRST occurrence of
# the phrase, so the decoy's bare digit won over the real invocation and the
# gate fetched PR 1. Command-position matching is what fixes it: `echo` holds
# the command position, so its arguments can never be a merge invocation.
new_case; invoke 'echo gh pr merge 1 && gh pr merge 2002'
assert_pr "unquoted leading decoy does not beat the real PR" 2002

# WAS A PINNED DEFECT, and the widest of the three. The old match tested the
# whole command TEXT, so the subcommand actually invoked was irrelevant: any
# command carrying the phrase plus a bare digit armed the gate. Both shapes
# below fired in production. Quote-aware tokenization fixes them — a quoted
# --body is ONE token, so prose inside it cannot match a command position.
new_case; invoke 'gh pr comment 2006 --body "the hook matches gh pr merge 1 in prose"'
assert_no_fetch "gh pr comment whose BODY quotes the phrase does not arm the gate"

new_case; invoke 'gh issue create --body "run gh pr merge 42 when ready"'
assert_no_fetch "command text carrying the phrase does not arm the gate"

# An assignment prefix does not consume the command position. Missing this in
# the prototype made the gate silently skip the shape — a fail-OPEN miss, the
# same class the rewrite exists to close, so it is pinned rather than assumed.
new_case; invoke 'GH_TOKEN=x gh pr merge 2002'
assert_pr "an env-assignment prefix still reaches the merge invocation" 2002

# Unparseable input must fall back to the permissive scan, never to silence.
# Over-arming is recoverable (the agent sees an unrelated review and retries);
# under-arming just lets the merge through.
new_case; invoke 'gh pr merge 2002 --body "unbalanced'
assert_pr "unbalanced quotes fall back to the legacy scan rather than arming nothing" 2002

# A real invocation inside a command substitution is still a real invocation.
new_case; invoke 'out=$(gh pr merge 2002)'
assert_pr "command substitution around the invocation still arms the gate" 2002

# A shell with flags before its own `-c`. Scoping the check to the token
# immediately preceding `-c` missed this; the owner is the segment's command
# word, which is what the code now tracks.
new_case; invoke 'bash -x -c "gh pr merge 2002"'
assert_pr "flags between the shell and its -c do not hide the invocation" 2002

# The QUOTED eval form is one opaque token, so WRAPPERS alone cannot see it —
# it needs the recursion that the unquoted form does not.
new_case; invoke 'eval "gh pr merge 2002"'
assert_pr "a quoted eval argument still arms the gate" 2002

# A decoy BEFORE a wrapper-run invocation. The backstop originally fell back
# to a raw-text scan, which reads the first textual occurrence — so it returned
# the decoy and reintroduced exactly the bug this file exists to fix. Two
# changes prevent it: `eval` is a wrapper (so the position-aware scan handles
# this directly), and the backstop scans TOKENS, which carry quoting.
new_case; invoke 'echo gh pr merge 1 && eval gh pr merge 2002'
assert_pr "a decoy before a wrapper-run invocation does not win" 2002

# The `-c` shell check must belong to the token that owns the flag. A shell
# named anywhere earlier in a compound command previously made an unrelated
# tool's `-c` argument get scanned as if it were a shell string.
new_case; invoke 'bash --version; grep -c "gh pr merge 42 mentioned" notes.txt'
assert_no_fetch "an earlier shell name does not make grep -c a shell string"

# THE STRUCTURAL BACKSTOP. When `gh pr merge` survives tokenization as three
# adjacent tokens but the command-position logic did not recognise the shape,
# a token-level scan runs rather than the gate exiting clean, so the NEXT
# unmodelled shape over-arms instead of becoming a silent bypass.
#
# The unquoted `eval` below no longer EXERCISES the backstop — `eval` is a
# wrapper now, so the primary scan resolves it. It stays as a regression pin
# for that path; the backstop's own coverage is the decoy case further down.
new_case; invoke 'eval gh pr merge 2002'
assert_pr "an unmodelled invocation shape falls back rather than exiting clean" 2002

# And the discriminator that keeps this file's headline fix: prose inside a
# quoted argument is ONE token, never three adjacent ones, so the backstop
# does not fire and the gate stays quiet.
new_case; invoke 'gh pr comment 2006 --body "the hook matches gh pr merge 1 in prose"'
assert_no_fetch "the backstop does not re-arm the gate on quoted prose"

# Utilities that RUN the following command do not consume the command
# position. `env FOO=bar gh pr merge N` extracted nothing at all — an under-arm.
new_case; invoke 'env GH_TOKEN=x gh pr merge 2002'
assert_pr "a wrapper utility does not consume the command position" 2002

new_case; invoke 'nohup gh pr merge 2002'
assert_pr "same for nohup" 2002

# The `-c` recursion must belong to a SHELL. Many tools take `-c`, and one
# whose argument merely quotes the phrase would otherwise arm the gate on it.
new_case; invoke 'grep -c "gh pr merge 2002" notes.txt'
assert_no_fetch "a non-shell -c argument is not scanned as a command"

# An empty-quoted ARGUMENT between `merge` and the PR number. `all()` over an
# empty string is True, so an empty token read as an operator and ended the
# digit scan before reaching the number — an under-arm.
new_case; invoke "gh pr merge '' 2002"
assert_pr "an empty argument does not end the PR-number scan" 2002

# Two REAL, differently-numbered invocations joined by a semicolon. A semicolon
# runs both sides unconditionally and in order, so the FIRST is the one that
# executes first and the one whose review must be surfaced. Added because a
# review argued the semicolon glues to the adjacent token and defeats the scan;
# measured, `;` IS in shlex's default punctuation set and splits correctly, so
# this pins the behaviour rather than fixing anything.
new_case; invoke 'gh pr merge 1; gh pr merge 2002'
assert_pr "semicolon-chained real invocations: the FIRST one arms the gate" 1
assert_stderr_has "…and the SECOND one is why the compound is refused" 'ONE MERGE PER COMMAND'

# ===========================================================================
# 2c. Compound merges — arming on the first is correct and not sufficient
#
# Observed in production: `gh pr merge A && gh pr merge B` armed the gate on A
# and B merged with no ack cycle of its own. The gate is attention-independent
# by design, so a shape that silently halves its coverage is a hole.
#
# The refusal is deliberately NOT ackable — a retry of the same command would
# reproduce the same hole — so the only way past it is one merge per command.
# It counts only invocations the PRECISE command-position scan resolved, for
# the same reason the delete-branch guard does: the fallback paths exist to
# over-arm, and hanging a non-ackable refusal off an over-arm has no way out.
#
# Upstream gates held inert: base `develop` (no release reminder), no
# `--delete-branch` (no worktree guard), and a review present (so the gate
# reaches the injection path at all).
# ===========================================================================
printf '\n--- compound merges ---\n'

SHIM_PR_BASE='develop'
SHIM_REVIEW_JSON="$LGTM"

new_case; invoke 'gh pr merge 2197 && gh pr merge 2198'
assert_exit "two real merges in one command: refused" 2
assert_stderr_has "…with the one-merge-per-command banner" 'ONE MERGE PER COMMAND'
assert_stderr_has "…naming the first PR" '2197'
assert_stderr_has "…and the second" '2198'
assert_pr "…and the gate still resolved the first as the armed one" 2197
assert_ack_lacks "…and nothing is acked, so the same command refuses again" '2197:777'

# The discriminator. A decoy is not a second invocation, and counting it would
# reintroduce the over-arm the extraction was rewritten to remove — against a
# refusal that cannot be acked past.
new_case; invoke 'echo gh pr merge 1 && gh pr merge 2002'
assert_stderr_lacks "a decoy alongside one real merge is not a compound" 'ONE MERGE PER COMMAND'
assert_pr "…and the real PR is still the armed one" 2002

new_case; invoke 'gh pr merge 2002 --rebase'
assert_stderr_lacks "a single merge does not trip the compound refusal" 'ONE MERGE PER COMMAND'
assert_pr "…and gates normally" 2002

# A merge wrapped in a shell string is a real invocation too, so a wrapped one
# beside a plain one is a compound. Without this the refusal is bypassable by
# spelling one half `bash -c`.
new_case; invoke 'bash -c "gh pr merge 2001" && gh pr merge 2002'
assert_stderr_has "a wrapped merge beside a plain one is a compound" 'ONE MERGE PER COMMAND'

# Both merges inside ONE nested shell string — the count has to survive the
# recursion, not just the top level.
new_case; invoke 'bash -c "gh pr merge 2001 && gh pr merge 2002"'
assert_stderr_has "two merges inside one -c string are still a compound" 'ONE MERGE PER COMMAND'

SHIM_REVIEW_JSON=''

new_case; invoke 'gh pr merge 2002;'
assert_pr "a trailing semicolon does not glue to the PR number" 2002

# An empty-quoted argument is a legitimate EMPTY-STRING token, not end of
# input. Treating it as EOF truncated the token stream and dropped every
# command after it — an under-arm.
new_case; invoke "echo '' && gh pr merge 2002"
assert_pr "an empty-string token does not truncate the scan" 2002

# A `-c` argument is a command in its own right, and arrives as ONE quoted
# token. Without recursion this is invisible — and the naive text scan this
# replaced DID catch it, so missing it would be a regression, not a gap.
new_case; invoke 'bash -c "gh pr merge 2002"'
assert_pr "a merge inside a -c string argument still arms the gate" 2002

# THE RECURSION DEPTH CAP, both sides of it. `extract` stops recursing past
# depth 3, and it used to resolve NOTHING there — so a merge nested four shells
# deep armed no gate and the hook exited 0, which is the under-arm direction the
# whole file is built to avoid. The cap now runs the token-adjacency backstop on
# the text it abandons, so the deep shape over-arms instead of vanishing.
#
# Built by wrapping rather than by hand, so the nesting depth is the loop count
# and not a hand-counted run of backslashes that is easy to get wrong by one.
#
# SINGLE-QUOTE wrapping specifically, not `printf %q`. %q escapes the SPACES
# (`gh\ pr\ merge`), and the hook's bash pre-filter requires the three words to
# be separated by real whitespace — so a %q-built fixture exits at the
# pre-filter and measures nothing, whichever way the depth cap behaves. Measured
# while writing these cases: both levels fetched no PR at all.
sq() { # <text> -> the text as one single-quoted shell word
  local escaped=${1//\'/\'\\\'\'}
  printf "'%s'" "$escaped"
}
nest_shells() { # <levels>
  local nested='gh pr merge 2002' i
  for ((i = 0; i < $1; i++)); do nested="bash -c $(sq "$nested")"; done
  printf '%s' "$nested"
}
new_case; invoke "$(nest_shells 3)"
assert_pr "three levels of shell nesting resolve the real PR" 2002

new_case; invoke "$(nest_shells 4)"
assert_pr "four levels hit the depth cap and still arm rather than exiting clean" 2002

# Five-plus levels leave a `bash -c '…'` wrap still on the text when the cap
# fires, so a token scan (which only sees the outermost layer) would find
# nothing and the under-arm would return one level deeper. The cap now runs a
# raw textual regex that reads through every wrap and tolerates the closing
# quote abutting the number, so a merge arms at ANY nesting depth.
new_case; invoke "$(nest_shells 5)"
assert_pr "five levels past the cap still arm via the textual scan" 2002

new_case; invoke "$(nest_shells 7)"
assert_pr "seven levels still arm — depth-independent at the cap" 2002

# ORDERING: candidates resolve in TOKEN order, which is execution order — not
# top-level-first. Draining the top level before recursing armed the gate on
# 2002 here, while the merge that actually runs first is 2001. Both are real
# merges, so the old behaviour was a precision bug rather than a bypass; it
# still showed an unrelated review.
new_case; invoke 'bash -c "gh pr merge 2001" && gh pr merge 2002'
assert_pr "a wrapped merge BEFORE a plain one wins on order" 2001

# The mirror case must not regress: a plain merge that genuinely comes first
# still wins over a later wrapped one.
new_case; invoke 'gh pr merge 2001 && bash -c "gh pr merge 2002"'
assert_pr "a plain merge before a wrapped one still wins" 2001

# Bash keywords that open a command position. `if`/`while`/`until` were absent
# while `then`/`do` were present, so a merge directly after them went ungated.
new_case; invoke 'if gh pr merge 2002; then echo ok; fi'
# SINGLE-quoted labels here and below: a backticked word inside a DOUBLE-quoted
# label is command substitution, and bash printed `command substitution: syntax
# error` to stderr for each one. The assertions still passed, so the only cost
# was noise that reads as a failing probe to anyone scanning stderr.
assert_pr 'a merge directly after `if` is at a command position' 2002

new_case; invoke 'while gh pr merge 2002; do echo retry; done'
assert_pr 'same after `while`' 2002

# A phrase-match that yields no PR number must not end the scan. The earlier
# implementation exited unconditionally after the first match, so a bare merge
# chained before a real one extracted NOTHING and the real merge went entirely
# ungated — an under-arm, the direction this hook must never fail in.
new_case; invoke 'gh pr merge && gh pr merge 2002'
assert_pr "a bare merge before a real one does not swallow the real PR" 2002

new_case; invoke 'gh pr merge; gh pr merge 2002'
assert_pr "same across a semicolon separator" 2002

# shlex returns adjacent punctuation as ONE token, so an enumerated operator
# set misses `&&(` and command position stays stuck.
new_case; invoke 'pnpm test &&( gh pr merge 2002 )'
assert_pr "glued punctuation still opens a command position" 2002

# Bash keywords open a command position too.
new_case; invoke 'if true; then gh pr merge 2002; fi'
assert_pr 'a merge after `then` is still at a command position' 2002

# Heredoc bodies are DATA, never commands — bash will not execute a word in
# one however shell-like it looks. shlex has no concept of heredocs, so
# without stripping them the body tokenizes as shell and any example command
# quoted in a PR body or commit message arms the gate on the digit after it.
#
# Not hypothetical: this hook fired on its own fix's `gh pr create`, pulling a
# PR number out of a markdown table cell that described the very bug being
# fixed. That is the same shape as one of the two production sightings.
new_case; invoke "$(printf 'gh pr create --body "$(cat <<%sEOF%s\nrun gh pr merge 42 when ready\nEOF\n)"' "'" "'")"
assert_no_fetch "a merge quoted inside a heredoc body does not arm the gate"

# The complement: stripping the body must not swallow a REAL invocation that
# follows the heredoc's terminator.
new_case; invoke "$(printf 'gh pr comment 7 --body "$(cat <<%sEOF%s\nsee gh pr merge 1\nEOF\n)" && gh pr merge 2002' "'" "'")"
assert_pr "a real merge after the heredoc terminator still arms the gate" 2002

# Unterminated heredoc strips NOTHING, so the body stays visible and the gate
# over-arms. That is deliberate. The opener is found by regex over raw text,
# which cannot tell a real redirection from the same characters inside a quoted
# argument — and the previous "drop to end-of-text" behaviour deleted whatever
# followed a FALSE match, which is a total bypass rather than a wrong PR.
new_case; invoke "$(printf 'gh pr create --body "$(cat <<%sEOF%s\nrun gh pr merge 42 when ready' "'" "'")"
assert_pr "an unterminated heredoc strips nothing, so the gate over-arms rather than vanishing" 42

# The bypass that behaviour used to cause, pinned so it cannot come back: a
# quoted string that merely LOOKS like a heredoc opener, with a real merge
# after it. Stripping to end-of-text here removed the real invocation entirely
# and the merge proceeded with no gate at all.
new_case; invoke 'gh pr comment 5 --body "see the <<EOF heredoc marker" && gh pr merge 2002'
assert_pr "a false heredoc opener inside quotes must not swallow the real merge" 2002

# `<<<` is a here-string, not a heredoc; its trailing `<` plus a bare word hit
# the same never-terminates path.
new_case; invoke 'cat <<<marker && gh pr merge 2002'
assert_pr "a here-string is not read as a heredoc opener" 2002

# `set -f` equivalent: the tokenizer must not expand a glob against the cwd,
# so a digit-named file cannot become a PR number.
GLOBDIR="$WORK/globdir"
mkdir -p "$GLOBDIR"
: >"$GLOBDIR/7"
new_case; invoke_in "$GLOBDIR" 'gh pr merge * 2002'
assert_pr "a glob token does not expand into a digit-named file" 2002

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

# RETARGET: the acked-retry path must re-evaluate the release obligation.
#
# The gap this pins: the ack fast path used to `exit 0` before the base was
# ever consulted, on the reasoning that a prior blocking call had already
# delivered any reminder. Retargeting develop->main between two attempts on the
# SAME review comment left the ack matching and the reminder never fired — the
# same staleness class as the base cache removed earlier, through another door.
new_case; SHIM_PR_BASE='develop'; SHIM_REVIEW_JSON="$LGTM"
invoke 'gh pr merge 2011 --rebase'
assert_exit "round 1 on a develop-based PR: review block" 2
assert_stderr_lacks "…no release reminder while based on develop" 'RELEASE PR — base is main'
SHIM_PR_BASE='main'
invoke 'gh pr merge 2011 --rebase'
assert_exit "retargeted to main on the SAME review: blocks for the reminder" 2
assert_stderr_has "…and the reminder finally fires" 'RELEASE PR — base is main'
assert_ack_has "…and the release key is acked" 'RELEASE:2011'
invoke 'gh pr merge 2011 --rebase'
assert_exit "third attempt: both obligations acked, merge proceeds" 0

# REVERSE retarget: main -> develop AFTER the reminder already fired. Correct by
# inspection (release_reminder_due checks the RELEASE ack before it ever looks
# at the base, so a fired reminder cannot re-fire), and pinned anyway — every
# gap this file has had was found by a case that was not there.
new_case; SHIM_PR_BASE='main'; SHIM_REVIEW_JSON="$LGTM"
invoke 'gh pr merge 2014 --rebase'
assert_exit "release PR round 1 blocks with the reminder" 2
assert_stderr_has "…reminder fired while based on main" 'RELEASE PR — base is main'
SHIM_PR_BASE='develop'
invoke 'gh pr merge 2014 --rebase'
assert_exit "retargeted BACK to develop: merge proceeds" 0
assert_silent "…and the fired reminder does not re-fire"

# FAIL-OPEN on the acked path. The acked retry is the highest-traffic path in
# this hook, and it now resolves the base — so a `gh` blip there must degrade to
# "no reminder", never to "cannot merge". Previously this path made no network
# call at all, so the blast radius of any fragility in it is new.
new_case; SHIM_PR_BASE='develop'; SHIM_REVIEW_JSON="$LGTM"
invoke 'gh pr merge 2013 --rebase'
assert_exit "round 1 blocks to surface the review" 2
SHIM_BASE_EXIT=1; SHIM_PR_BASE=''
invoke 'gh pr merge 2013 --rebase'
assert_exit "acked retry with a FAILING base lookup still allows the merge" 0
assert_silent "…and says nothing, rather than blocking on a gh blip"
SHIM_BASE_EXIT=0

# The acked path stays free of a SECOND block once the release key exists —
# the reminder is once per PR, not once per retry.
new_case; SHIM_PR_BASE='main'; SHIM_REVIEW_JSON="$LGTM"
invoke 'gh pr merge 2012 --rebase'
assert_exit "release PR round 1 blocks" 2
invoke 'gh pr merge 2012 --rebase'
assert_exit "acked retry on a release PR proceeds" 0
assert_silent "…silently — no repeated reminder"

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
# 6a. Added-comment claim scan
#
# The scan reads the PR DIFF, not the review, so its fixtures are independent
# of SHIM_REVIEW_JSON — but the review still has to be present, because the
# paragraph rides the review-gate block and never prints on its own. Every
# upstream gate is held inert: base `develop` (no release reminder) and no
# `--delete-branch` (no worktree guard), so a failure here is the scan's.
# ===========================================================================
printf '\n--- added-comment claim scan ---\n'

SHIM_PR_BASE='develop'
SHIM_REVIEW_JSON="$LGTM"

# One added comment carrying two of the three vocabulary classes (certainty
# and provenance), beside an added code line that must not itself match.
DIFF_CLAIM=$(printf 'diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1,2 +1,4 @@\n const a = 1;\n+  // this value always comes from the catalog\n+const b = resolve(a);\n')

# The negative fixture. A STANDALONE `always` token sits in a CODE line — it
# must be standalone, not `alwaysOn`, because the `\b`-anchored vocabulary
# cannot match inside a longer identifier and the fixture would then pass
# vacuously. As written, a regression that dropped the comment-shape filter
# lights this case up: the code line matches the vocabulary and only the
# shape filter keeps it out of the banner.
DIFF_CLEAN=$(printf 'diff --git a/src/y.ts b/src/y.ts\n--- a/src/y.ts\n+++ b/src/y.ts\n@@ -1,2 +1,4 @@\n+// helper for the parser\n+if (always) { return; }\n+const parsed = parse(input);\n')

# The substring fixture: an added COMMENT line whose only claim vocabulary is
# buried inside longer words — "whenever" carries `never`, "spread from" carries
# `read from`. This is the case the `\b` anchors exist for, and it goes red the
# moment any of them is dropped.
DIFF_SUBSTRING=$(printf 'diff --git a/src/z.ts b/src/z.ts\n--- a/src/z.ts\n+++ b/src/z.ts\n@@ -1,2 +1,3 @@\n+// call this whenever the flag changes; values spread from config\n+const z = 1;\n')

# Thirteen claim-shaped comment lines — one past the 12-line display cap, so the
# banner has to say it is truncating rather than report the cap as the total.
DIFF_MANY=$(printf 'diff --git a/src/m.ts b/src/m.ts\n--- a/src/m.ts\n+++ b/src/m.ts\n@@ -1,2 +1,15 @@\n')
for claim_i in $(seq 1 13); do
  DIFF_MANY="${DIFF_MANY}"$'\n'"+// claim ${claim_i}: this can never be null"
done

new_case; SHIM_PR_DIFF="$DIFF_CLAIM"
invoke 'gh pr merge 2002 --rebase'
assert_exit "claim-shaped comment: still blocks to surface the review" 2
assert_stderr_has "…and the review is still injected" 'LGTM. No actionable findings.'
assert_stderr_has "claim scan fires" 'CLAIM-SHAPED ADDED COMMENTS'
assert_stderr_has "…and quotes the matched line" 'this value always comes from the catalog'
assert_stderr_has "…and says what to do about it" 'hedge it'
# The verification instruction fires at the one moment the code it names is
# most likely to be on a branch the shell is not standing on, so it has to name
# the ref. The shim's headRefName is `feat/example`, so the concrete form is
# assertable — an abstract "use the PR's ref" would pass a substring check
# without ever having resolved anything.
assert_stderr_has "…and names the branch hazard" 'not the working tree'
assert_stderr_has "…with the PR's own head ref, resolved" 'origin/feat/example'

new_case; SHIM_PR_DIFF="$DIFF_CLEAN"
invoke 'gh pr merge 2002 --rebase'
assert_exit "no claim-shaped comment: still blocks to surface the review" 2
assert_stderr_lacks "neutral diff: no claim paragraph" 'CLAIM-SHAPED'
# The branch-hazard line rides the claim paragraph and must not print on its
# own — otherwise every merge carries an instruction with nothing to apply it
# to, and the assertion above would pass on a hook that printed it always.
assert_stderr_lacks "neutral diff: no branch-hazard line either" 'not the working tree'

new_case; SHIM_PR_DIFF="$DIFF_SUBSTRING"
invoke 'gh pr merge 2002 --rebase'
assert_exit "substring-only comment: still blocks to surface the review" 2
assert_stderr_has "…review still injected" 'LGTM. No actionable findings.'
assert_stderr_lacks "…and 'whenever'/'spread from' do not light the banner" 'CLAIM-SHAPED'

new_case; SHIM_PR_DIFF="$DIFF_MANY"
invoke 'gh pr merge 2002 --rebase'
assert_exit "13 claim lines: still blocks to surface the review" 2
assert_stderr_has "…and the banner names the truncation" 'showing first 12 of 13'
assert_stderr_lacks "…rather than reporting the cap as the total" 'ADDED COMMENTS (12 line(s))'
assert_stderr_has "…the 12th line is shown" 'claim 12:'
assert_stderr_lacks "…and the 13th is the one held back" 'claim 13:'

# Fail-open. A diff fetch that cannot run must leave the gate exactly as it was
# — no paragraph, no warning about the fetch, and the review still surfaced.
new_case; SHIM_PR_DIFF="$DIFF_CLAIM"; SHIM_DIFF_EXIT=1
invoke 'gh pr merge 2002 --rebase'
assert_exit "diff fetch fails: gate unchanged, still blocks on the review" 2
assert_stderr_has "…review still injected" 'LGTM. No actionable findings.'
assert_stderr_lacks "…and no claim paragraph" 'CLAIM-SHAPED'
SHIM_DIFF_EXIT=0
SHIM_PR_DIFF=''

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
# 9. The --delete-branch precondition
#
# Scope note, because it is the whole design and a future edit will be tempted
# to widen it: the guard fires on a worktree OTHER than the current one. gh
# switches the CURRENT worktree off the head branch before deleting it, so that
# case works and blocking it would block the ordinary "merge my feature branch"
# invocation. Case 3 below pins exactly that, and it is the case most likely to
# be broken by someone implementing the rule from its one-line description.
# ===========================================================================
printf '\n--- delete-branch precondition ---\n'

# Two worktrees: the current one on develop, another holding the head branch.
OTHER_TREE='/repo/../wt-a'
WT_CONFLICT=$(printf 'worktree /repo\nHEAD aaa\nbranch refs/heads/develop\n\nworktree %s\nHEAD bbb\nbranch refs/heads/feat/example\n' "$OTHER_TREE")
# The same two trees, except the head branch is held by the CURRENT one.
WT_CURRENT_ONLY=$(printf 'worktree /repo\nHEAD aaa\nbranch refs/heads/feat/example\n\nworktree %s\nHEAD bbb\nbranch refs/heads/other\n' "$OTHER_TREE")
# Nobody holds it, and one worktree is detached (no `branch` line at all).
WT_CLEAN=$(printf 'worktree /repo\nHEAD aaa\nbranch refs/heads/develop\n\nworktree %s\nHEAD bbb\ndetached\n' "$OTHER_TREE")

SHIM_PR_BASE='develop'
SHIM_PR_HEAD='feat/example'
SHIM_CURRENT_TREE='/repo'
SHIM_REVIEW_JSON="$LGTM"

new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke 'gh pr merge 2002 --rebase --delete-branch'
assert_exit "another worktree holds the head branch: blocked" 2
assert_stderr_has "…names the branch" 'feat/example'
assert_stderr_has "…names the offending worktree path" "$OTHER_TREE"
assert_stderr_has "…and gives a fix" 'git worktree remove'
# Ordering: the guard runs BEFORE the review fetch, so a blocked merge costs no
# review round trip and the agent reads the precondition alone rather than
# hunting for it under an injected review.
assert_no_fetch "…without fetching the review first"
assert_ack_lacks "…and writes no review ack" '2002:777'

# Not ackable, and this pair is what says so. The review gate's whole contract
# is "block once, then allow"; inheriting that here would make the guard
# decorative — the second attempt would delete the branch anyway.
#
# It runs with NO review fixture on a develop-based PR, which is the only
# arrangement that can detect the failure. Under the LGTM fixture above, an
# ackable guard falls through to the review gate, which blocks with the SAME
# exit 2 — measured, by mutating the hook to write and honour a per-PR ack:
# every assertion in this section stayed green. With no review to fall through
# to, an acked second call exits 0 and the mutation is caught.
new_case; SHIM_WORKTREES="$WT_CONFLICT"; SHIM_REVIEW_JSON=''
invoke 'gh pr merge 2002 --rebase --delete-branch'
assert_exit "no-review fixture: first attempt blocked by the precondition" 2
assert_stderr_has "…with the precondition banner" 'PR MERGE BLOCKED'
invoke 'gh pr merge 2002 --rebase --delete-branch'
assert_exit "retrying the same command is blocked again (no ack path)" 2
assert_stderr_has "…still the precondition, not a spent gate" 'PR MERGE BLOCKED'
SHIM_REVIEW_JSON="$LGTM"

# THE REFINEMENT. gh switches the current worktree off the head branch and then
# deletes it, so this is the ordinary merge and must pass straight through to
# the review gate.
new_case; SHIM_WORKTREES="$WT_CURRENT_ONLY"
invoke 'gh pr merge 2002 --rebase --delete-branch'
assert_stderr_lacks "current worktree on the head branch: not the guard's case" 'PR MERGE BLOCKED'
assert_pr "…and control reaches the review gate normally" 2002

new_case; SHIM_WORKTREES="$WT_CLEAN"
invoke 'gh pr merge 2002 --rebase --delete-branch'
assert_stderr_lacks "branch checked out nowhere: passes through" 'PR MERGE BLOCKED'
assert_pr "…and reaches the review gate" 2002

# Short forms. `-d` is the documented shorthand and pflag clusters booleans, so
# `-rd` is a real invocation shape — matching only the long flag would leave a
# silent hole that looks exactly like a correct pass.
#
# Both assert the BANNER, not just exit 2. Exit 2 alone was measured to pass
# with the short-flag pattern deleted from the hook, because the review gate
# blocks with the same code — a test that reported coverage while verifying
# nothing about the flag it was named for.
new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke 'gh pr merge 2002 --rebase -d'
assert_exit "short flag -d is the same flag: blocked" 2
assert_stderr_has "…by the precondition, not the review gate" 'PR MERGE BLOCKED'

new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke 'gh pr merge 2002 -rd'
assert_exit "clustered short flags -rd: blocked" 2
assert_stderr_has "…by the precondition, not the review gate" 'PR MERGE BLOCKED'

# The negative half of the cluster pattern. A regex loose enough to match any
# flag containing a `d` would block every merge on a repo with worktrees, which
# would read as "the guard works" right up until someone merges without -d.
new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke 'gh pr merge 2002 --rebase --admin'
assert_stderr_lacks "no delete flag: guard does not fire" 'PR MERGE BLOCKED'
assert_pr "…and the merge reaches the review gate" 2002

# The flag must belong to the MERGE, not merely to the command line. Both of
# these were live false positives under a raw whole-command match: the guard is
# not ackable, so a false block told the agent to tear down a worktree that had
# nothing to do with the command, under a banner explaining a flag that was
# never passed. Found in review of this PR.
new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke 'gh pr merge 2002 --rebase && git branch -d old-feature'
assert_stderr_lacks "a chained unrelated -d does not arm the guard" 'PR MERGE BLOCKED'
assert_pr "…and the merge still reaches the review gate" 2002

new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke 'gh pr merge 2002 --rebase && find . -delete'
assert_stderr_lacks "a chained --delete-shaped flag does not arm the guard" 'PR MERGE BLOCKED'
assert_pr "…and the merge still reaches the review gate" 2002

# Quoted prose is ONE token, so an anchored full-token match cannot see a flag
# inside it — the same property that keeps a quoted --body from arming the
# PR-number extraction, now relied on by the flag check too.
new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke 'gh pr merge 2002 --rebase --body "remove the -d flag from the config script"'
assert_stderr_lacks "a -d inside a quoted --body does not arm the guard" 'PR MERGE BLOCKED'
assert_pr "…and the merge still reaches the review gate" 2002

# The other half of the same property: cross-attribution between two REAL merge
# invocations. The gate arms on the first, so the second's flag is not its flag.
new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke 'gh pr merge 2001 --rebase && gh pr merge 2002 -d'
assert_stderr_lacks "a LATER merge's flag is not attributed to the armed one" 'PR MERGE BLOCKED'
assert_pr "…and the gate still arms on the first invocation" 2001

# …and the converse, so the case above cannot pass by the flag check simply
# being broken: when the ARMED invocation is the one carrying the flag, it fires.
new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke 'gh pr merge 2002 -d && echo done'
assert_exit "the armed invocation's own flag still fires" 2
assert_stderr_has "…by the precondition" 'PR MERGE BLOCKED'

# pflag accepts `--flag=value` for BOOLEANS — measured against this `gh`:
# `--draft=true` parses and `--draft=notabool` fails with strconv.ParseBool, so
# the value really is being parsed as a bool. `--delete-branch=true` is
# therefore a real shape, and anchoring the token match on `$` alone silently
# let it through — an UNDER-arm, where the merge proceeds and deletes the
# branch. Found in review; the eight-mutation canary table did not cover it,
# which is what a missing shape looks like from the inside.
new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke 'gh pr merge 2002 --rebase --delete-branch=true'
assert_exit "explicit --delete-branch=true is the same flag: blocked" 2
assert_stderr_has "…by the precondition" 'PR MERGE BLOCKED'

# The negative that keeps the `=` boundary honest: `=false` is still the flag
# being PRESENT as far as this guard is concerned. Over-arming on an explicit
# opt-out is the safe direction (a block the reader can dismiss), and pretending
# to parse the value would mean reimplementing pflag's bool grammar here.
new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke 'gh pr merge 2002 --rebase --delete-branch=false'
assert_exit "--delete-branch=false also blocks — the value is not parsed" 2
# The banner, not just exit 2: the review gate blocks with the same code, so the
# exit assertion alone stays green even with the `=` boundary removed. Third
# time this shape has appeared in this file — see the -d/-rd pair above.
assert_stderr_has "…by the precondition" 'PR MERGE BLOCKED'

# The asymmetric git failure: rev-parse fails, worktree list succeeds. Without
# an explicit empty-CURRENT_TREE check the comparison is `path != ""`, true for
# EVERY worktree, so a single failed command flips the guard from fail-open to
# block-everything. The SHIM_GIT_EXIT case cannot see this — it fails both.
new_case; SHIM_WORKTREES="$WT_CONFLICT"; SHIM_CURRENT_TREE=''
invoke 'gh pr merge 2002 --rebase --delete-branch'
assert_stderr_lacks "unresolvable current worktree: fails open, not closed" 'PR MERGE BLOCKED'
assert_pr "…and the review gate still runs" 2002
SHIM_CURRENT_TREE='/repo'

# The flag has to survive the RECURSION, not just the top-level scan. `bash -c`
# and quoted `eval` arguments are one opaque token, so the invocation inside is
# found by re-entering extract() — and the flag now rides back out of that call
# alongside the PR number. Nothing else pins the flag half of that return, so a
# future edit to the recursive branch could drop it and stay green: the PR
# number would still resolve, the gate would still arm, and only the
# delete-branch guard would silently stop firing.
new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke 'bash -c "gh pr merge 2002 --rebase --delete-branch"'
assert_exit "flag propagates out of a bash -c recursion: blocked" 2
assert_stderr_has "…by the precondition" 'PR MERGE BLOCKED'

new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke 'eval "gh pr merge 2002 --rebase -d"'
assert_exit "…and out of a quoted eval recursion" 2
assert_stderr_has "…by the precondition" 'PR MERGE BLOCKED'

# The negative half: recursion must not INVENT a flag either. Same nesting, no
# delete flag — without this, a recursive branch hardcoding "flag=True" would
# pass both cases above.
new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke 'bash -c "gh pr merge 2002 --rebase"'
assert_stderr_lacks "recursion does not invent a flag that was not passed" 'PR MERGE BLOCKED'
assert_pr "…and the gate still arms on the nested invocation" 2002

# A redirection does not end a command's argument list in bash, but shlex hands
# back `2>&1` as `2`, `>&`, `1` — and `>&` is an all-punctuation run, so the
# generic boundary test reads it as a separator. That truncated the flag walk
# before it reached the flag: an UNDER-arm, the direction this file must never
# fail in. Found in review as a code-reading hypothesis and confirmed by
# tokenizing the string directly.
new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke 'gh pr merge 2002 --rebase 2>&1 --delete-branch'
assert_exit "a flag after a 2>&1 redirection is still seen: blocked" 2
assert_stderr_has "…by the precondition" 'PR MERGE BLOCKED'

new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke 'gh pr merge 2002 --rebase > out.log --delete-branch'
assert_exit "…and after a plain > redirection" 2
assert_stderr_has "…by the precondition" 'PR MERGE BLOCKED'

# The PR-NUMBER walk must stay STRICT while the flag walk is loosened, and this
# is the case that shows why they cannot share a helper. A redirection TARGET
# that happens to be all digits is not a PR number; the strict walk stops at the
# `>` and never sees it, while a redirection-tolerant number scan would collect
# it and gate a completely unrelated PR — the wrong-PR failure the tokenizer
# exists to prevent.
#
# The first version of this case used `gh pr merge 2>&1 --delete-branch` and
# asserted no fetch. That passed VACUOUSLY: the guard blocked before the fetch
# could happen, so the assertion never exercised the number walk at all — and
# the claim in its name was false, since the `2` of `2>&1` precedes the
# redirection and IS collected either way. This shape carries no delete flag, so
# reaching the fetch (or not) depends only on the number scan.
new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke 'gh pr merge --rebase > 2'
assert_no_fetch "an all-digit redirection TARGET is not read as a PR number"

# A real separator still ends the walk, so loosening redirections did not
# quietly re-open the chained-command false positive fixed in round 1.
new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke 'gh pr merge 2002 --rebase > out.log && git branch -d old-feature'
assert_stderr_lacks "a chained -d past a redirection still does not arm" 'PR MERGE BLOCKED'
assert_pr "…and the merge still reaches the review gate" 2002

# A bare NEWLINE separates statements in bash, but shlex counts it as ordinary
# whitespace and emits no token for it — so a walk over the invocation's args
# strolls into the next statement. Same failure as the round-1 `&&` case,
# reached through a shape that needs no operator at all: two commands on two
# lines is how sequential work is ordinarily written.
#
# The existing "separator: newline" case does not cover this — it puts the
# unrelated command BEFORE the merge, so nothing walks forward into it.
new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke "$(printf 'gh pr merge 2002 --rebase\ngit branch -d old-feature')"
assert_stderr_lacks "a -d on the NEXT line does not arm the guard" 'PR MERGE BLOCKED'
assert_pr "…and the merge still reaches the review gate" 2002

# The same boundary, on the PR-NUMBER walk: a bare digit belonging to a later
# statement must not become the resolved PR. This is the wrong-PR failure the
# tokenizer exists to prevent, reached through the newline instead of an
# operator. No delete flag here, so the guard cannot mask the result.
new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke "$(printf 'gh pr merge --rebase\necho 5')"
assert_no_fetch "a digit on the NEXT line is not read as the PR number"

# The exception that makes the boundary a line-CHANGE test rather than a
# line-NUMBER test: shlex emits a literal newline TOKEN for a `\`-continuation
# and bumps the line anyway, so by line number alone a continued invocation is
# indistinguishable from a statement break. Stopping there would drop a real
# flag — an under-arm. Measured, not assumed.
new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke "$(printf 'gh pr merge 2002 --rebase \\\n  --delete-branch')"
assert_exit "a flag past a backslash-continuation is still seen: blocked" 2
assert_stderr_has "…by the precondition" 'PR MERGE BLOCKED'

# A `\`-CONTINUATION is not a command break, and treating it as one made a
# decoy read as a real invocation. Real bash runs the command below as ONE
# `echo` — `gh` never executes — but the line change reset the command position
# onto `gh`, the gate armed on 2002, and the NOT-ackable guard blocked it
# permanently.
#
# Two things are asserted together because they are separate mechanisms: the
# command-position reset now uses the same boundary as the arg walks, AND the
# permissive backstop no longer reports a flag. Either alone still blocks —
# measured, by applying them one at a time.
#
# Whitespace matters in the fixture and is easy to get wrong: with NO indent on
# the continuation line, shlex glues the newline to the next word (`\ngh`), so
# `gh` never appears as a bare token and nothing arms at all. The reviewer's
# original repro had that shape and did not reproduce. The indent is what makes
# this a real case.
new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke "$(printf 'echo decoy \\\n  gh pr merge 2002 --delete-branch')"
assert_stderr_lacks "a backslash-continued decoy does not block" 'PR MERGE BLOCKED'
# The REVIEW gate still arms on 2002 here, and that is correct rather than a
# leftover: the backstop's over-arm costs one retry past an unrelated review,
# which is the trade it was built for. Only the non-ackable guard had to stop.
assert_stderr_has "…while the review gate still over-arms, as designed" 'PR MERGE GATE'

# The strict PR-number walk stops at the first redirection, so a number placed
# AFTER one is never found — which disarms the hook completely, review gate
# included, not just the delete-branch guard. Documented here rather than fixed:
# collecting past the redirection is what would let `> 2` become a PR number,
# and the number virtually always follows `merge` directly.
new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke 'gh pr merge --rebase > out.log 2002'
assert_no_fetch "a PR number after a redirection disarms the whole hook"

# A redirection TARGET is never a flag, however it is spelled. Stepping over
# the operator but not its target left the target scannable, so a file named
# `-d` read as the flag — a false, unretryable block on a command carrying no
# delete flag at all. The existing redirection cases all used non-flag-shaped
# targets (`out.log`, `1`, `2`), which is exactly why six rounds of mutation
# testing did not surface it.
new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke 'gh pr merge 2002 --rebase > -d'
assert_stderr_lacks "a redirection target named -d is not the flag" 'PR MERGE BLOCKED'
assert_pr "…and the merge reaches the review gate" 2002

new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke 'gh pr merge 2002 --rebase > --delete-branch'
assert_stderr_lacks "…nor is a target named --delete-branch" 'PR MERGE BLOCKED'
assert_pr "…and the merge reaches the review gate" 2002

# The converse, so consuming the target cannot quietly swallow a REAL flag that
# follows it — which would be an under-arm, the worse direction.
new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke 'gh pr merge 2002 --rebase > -d --delete-branch'
assert_exit "…while a real flag AFTER that target is still seen: blocked" 2
assert_stderr_has "…by the precondition" 'PR MERGE BLOCKED'

# A MULTI-LINE QUOTED ARGUMENT sits inside one invocation, and the boundary
# check must not read it as a statement break. `shlex.lineno` counts newlines
# consumed inside a quoted token but reports each token's START line, so a
# `--title "a\nb"` leaves the following token on a later line than the value
# began on. Comparing start lines read that as a break, mid-invocation.
#
# Both severities are pinned because they are different failures. With the
# value before the FLAG the guard silently does not fire (an under-arm — the
# branch is deleted despite the conflict). With it before the NUMBER nothing
# resolves at all, which disarms the review gate and the release reminder too,
# not just this guard.
new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke "$(printf 'gh pr merge 2002 --rebase --title "line one\nline two" --delete-branch')"
assert_exit "a flag past a multi-line quoted value is still seen: blocked" 2
assert_stderr_has "…by the precondition" 'PR MERGE BLOCKED'

new_case; SHIM_WORKTREES="$WT_CLEAN"
invoke "$(printf 'gh pr merge --title "line one\nline two" 2002 --rebase')"
assert_pr "a PR number past a multi-line quoted value still resolves" 2002

# The control that keeps the pair honest: the same command with a single-line
# value behaved correctly even while the multi-line form was broken, so a
# fixture without the embedded newline proves nothing about this boundary.
new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke 'gh pr merge 2002 --rebase --title "one line" --delete-branch'
assert_exit "control: single-line value, same command shape" 2

# A `\`-continuation between a redirection operator and its target is not the
# target. Consuming it as one left the real target scannable, re-opening the
# `> -d` false block one line down — the round-8 bug reached through the
# round-6/7 boundary. The suite tested continuation-without-redirection and
# redirection-without-continuation, but not their intersection.
new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke "$(printf 'gh pr merge 2002 --rebase > \\\n  --delete-branch')"
assert_stderr_lacks "a continuation before a redirection target is not the flag" 'PR MERGE BLOCKED'
assert_pr "…and the merge reaches the review gate" 2002

# The converse: consuming the target across a continuation must not swallow a
# REAL flag that follows it, which would be an under-arm.
new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke "$(printf 'gh pr merge 2002 --rebase > \\\n  out.log --delete-branch')"
assert_exit "…while a real flag after that target is still seen: blocked" 2
assert_stderr_has "…by the precondition" 'PR MERGE BLOCKED'

# `git worktree list` failing ALONE, with `rev-parse` succeeding. The combined
# SHIM_GIT_EXIT case cannot reach this: the empty-CURRENT_TREE check short-
# circuits first, so the worktree query never runs. The script sets `pipefail`
# but not `errexit`, so the failed pipeline yields an empty result rather than
# aborting — which is the fail-open guarantee, now pinned rather than assumed.
new_case; SHIM_WORKTREES="$WT_CONFLICT"; SHIM_WORKTREE_EXIT=128
invoke 'gh pr merge 2002 --rebase --delete-branch'
assert_stderr_lacks "worktree list failing alone: fails open" 'PR MERGE BLOCKED'
assert_pr "…and the review gate still runs" 2002
SHIM_WORKTREE_EXIT=0

# A SHELL WRAPPER spelled any way bash accepts. Exact equality on both the
# shell name and the `-c` flag missed two ordinary shapes, and each disarmed
# EVERY gate — no review injected, no precondition, no release reminder —
# because the merge sits inside one opaque quoted token where even the
# structural backstop cannot see it. Measured before the fix: `bash -c` blocked
# while `bash -lc` and `/bin/bash -c` exited 0.
new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke 'bash -lc "gh pr merge 2002 --rebase --delete-branch"'
assert_exit "clustered shell flag (-lc) still recurses: blocked" 2
assert_stderr_has "…by the precondition" 'PR MERGE BLOCKED'

new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke '/bin/bash -c "gh pr merge 2002 --rebase --delete-branch"'
assert_exit "path-qualified shell still recurses: blocked" 2
assert_stderr_has "…by the precondition" 'PR MERGE BLOCKED'

# The gate half, not just the guard half: without the flag the review gate must
# still arm on the nested PR, which is what "disarmed EVERY gate" meant.
new_case; SHIM_WORKTREES="$WT_CLEAN"
invoke '/usr/bin/env bash -lc "gh pr merge 2002 --rebase"'
assert_pr "…and the review gate arms on the nested PR" 2002

# The negative: a non-shell with a -c flag must NOT recurse, or `grep -c` and
# friends start arming the gate on whatever digit follows.
new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke 'grep -c "gh pr merge 1 --delete-branch" file.txt'
assert_no_fetch "a non-shell -c does not recurse into its argument"

# `eval` as a bare ARGUMENT to something else is not an eval invocation. The
# ungated token match fired wherever the word appeared: measured, this command
# — which real bash runs as `echo` and nothing more — recursed into echo's own
# argument and blocked, against a guard that cannot be acked past.
new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke 'echo eval "gh pr merge 2002 --delete-branch"'
assert_stderr_lacks "eval as another command's argument does not block" 'PR MERGE BLOCKED'
assert_no_fetch "…and resolves no PR at all"

# The converse, so gating eval did not simply disable it: the real quoted form
# still recurses and still arms.
new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke 'eval "gh pr merge 2002 --rebase --delete-branch"'
assert_exit "a genuine quoted eval still recurses: blocked" 2
assert_stderr_has "…by the precondition" 'PR MERGE BLOCKED'

# pflag GLUES a value onto a short flag — measured, `gh pr list -L2` behaves
# identically to `-L 2` — so in a cluster everything after the first
# value-taking letter is that value. `-bd` is a body of "d", not a delete flag,
# and reading it as one produced a false block on a merge that would never
# delete anything.
new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke 'gh pr merge 2002 --rebase -bd'
assert_stderr_lacks "-bd is a body value, not the delete flag" 'PR MERGE BLOCKED'
assert_pr "…and the merge reaches the review gate" 2002

# The two neighbours that keep that rule from being a blanket exemption: a
# boolean before the `d` still carries it, and a `d` BEFORE the value-taker
# does too.
new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke 'gh pr merge 2002 -rd'
assert_exit "-rd: a boolean before d still carries the flag" 2
new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke 'gh pr merge 2002 -db some-body'
assert_exit "-db: d precedes the value-taker, so it carries" 2

# A KNOWN GAP, pinned so it is a decision rather than a surprise. `gh pr merge`
# with no PR number is valid — gh resolves the PR from the checked-out branch —
# and it is arguably the most natural moment to pass --delete-branch, since you
# are sitting on the branch you are retiring. But PR-number extraction requires
# a literal digit, so the hook exits before EITHER gate: no review injected, no
# worktree precondition. This case asserts the bypass rather than the fix,
# because closing it changes the review gate for every merge and needs its own
# probe matrix — tracked as TASK-554. Delete this case when that lands.
new_case; SHIM_WORKTREES="$WT_CONFLICT"
invoke 'gh pr merge --rebase --delete-branch'
assert_exit "numberless merge: no gate fires at all (known gap, TASK-554)" 0
assert_no_fetch "…not even the review fetch"

# The release-PR shape: base main, no flag. This is why the guard needs no
# special-casing for releases.
new_case; SHIM_PR_BASE='main'; SHIM_PR_HEAD='develop'
# SHIM_CURRENT_TREE is set explicitly rather than inherited, for
# self-containment (02-code-standards § Core Principles). Measured, so the
# reason is not overstated: this case is currently INSENSITIVE to the value —
# the command carries no delete flag, so the guard never runs and never asks
# git for the current worktree. Poisoning the inherited value upstream changes
# nothing. The explicit line is hygiene against a future flag-carrying variant
# of this case, not a fix for a live fragility.
SHIM_CURRENT_TREE='/repo'
SHIM_WORKTREES=$(printf 'worktree /repo\nHEAD aaa\nbranch refs/heads/develop\n')
SHIM_REVIEW_JSON=''
invoke 'gh pr merge 2010 --rebase'
assert_stderr_lacks "release PR without the flag: guard silent" 'PR MERGE BLOCKED'
assert_stderr_has "…and the release reminder still fires" 'release:finalize'

# The inverse, and the highest-value case the guard can catch: a release PR
# that DOES carry the flag. Its head branch is `develop`, which is checked out
# by definition — 00-critical § Long-Lived Branch Protection, and the
# 2026-08-07 post-mortem where develop was actually deleted.
new_case; SHIM_PR_BASE='main'; SHIM_PR_HEAD='develop'
SHIM_CURRENT_TREE='/repo/../wt-a'
SHIM_WORKTREES=$(printf 'worktree /repo\nHEAD aaa\nbranch refs/heads/develop\n')
invoke 'gh pr merge 2010 --rebase --delete-branch'
assert_exit "release PR carrying --delete-branch: blocked" 2
# Again the banner rather than the exit code: with no review fixture in play a
# release PR already exits 2 to deliver its finalize reminder, and that reminder
# mentions `develop` too — so both weaker assertions would pass with the guard
# removed entirely.
assert_stderr_has "…by the precondition" 'PR MERGE BLOCKED'
assert_stderr_has "…naming develop as the branch at risk" 'develop'

# Fail-open, both halves. A guard that blocks when its own lookups break is
# worse than no guard: it stops merges for reasons unrelated to the merge.
SHIM_PR_BASE='develop'; SHIM_CURRENT_TREE='/repo'; SHIM_REVIEW_JSON="$LGTM"

new_case; SHIM_PR_HEAD=''; SHIM_WORKTREES="$WT_CONFLICT"
invoke 'gh pr merge 2002 --rebase --delete-branch'
assert_stderr_lacks "unresolvable head ref: fails open" 'PR MERGE BLOCKED'
assert_pr "…and the review gate still runs" 2002

new_case; SHIM_PR_HEAD='feat/example'; SHIM_GIT_EXIT=128
invoke 'gh pr merge 2002 --rebase --delete-branch'
assert_stderr_lacks "git unavailable (not a repo): fails open" 'PR MERGE BLOCKED'
assert_pr "…and the review gate still runs" 2002
SHIM_GIT_EXIT=0

# A worktree path with a space. The porcelain format is line-oriented, so the
# path must be read as the rest of the line — field-splitting would truncate it
# at the space and print a path the reader cannot act on.
new_case
SHIM_WORKTREES=$(printf 'worktree /repo\nHEAD aaa\nbranch refs/heads/develop\n\nworktree /tmp/my worktree\nHEAD bbb\nbranch refs/heads/feat/example\n')
invoke 'gh pr merge 2002 --rebase --delete-branch'
assert_exit "worktree path containing a space: blocked" 2
assert_stderr_has "…and the path is printed whole" '/tmp/my worktree'
# The path appearing is NOT enough — the message also offers two commands to
# paste, and unquoted they break on exactly the shape the detection was hardened
# for: `git worktree remove /tmp/my worktree` takes an extra positional, and
# `-C /tmp/my` leaves `worktree` parsed as the subcommand. Asserting the raw path
# alone let that through.
assert_stderr_has "…and the remove suggestion is quoted" "git worktree remove '/tmp/my worktree'"
assert_stderr_has "…as is the detach suggestion" "git -C '/tmp/my worktree' checkout --detach"

SHIM_WORKTREES=''

# ===========================================================================
# 10. Leak guard — the live ack file must be untouched
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
