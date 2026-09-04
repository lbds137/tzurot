#!/bin/bash
# Fixture check for pr-body-ref-gate.sh — run after ANY edit to the hook.
#
# The hook decides ONE thing: block a `gh pr create`/`gh pr edit`/
# `pnpm ops gh:pr-edit` whose --body (or --body-file content) claims a
# tracker reference that does not resolve on origin/develop. Every case runs
# it inside a THROWAWAY git repo built here rather than the real repo — CI
# checkouts can be shallow and may not carry an `origin/develop` ref at all,
# which would silently turn every blocking case into a fail-open pass if the
# probe depended on the real repo's remote-tracking state. The fixture
# filenames mirror the real tracker/ shape (`tracker/tasks/task-<N> - ….md`,
# `tracker/archive/tasks/…`, `tracker/docs/doc-<N> - ….md`) so the hook's
# `/task-<n> ` / `/doc-<n> ` matching is exercised against realistic paths.
#
# Usage: .claude/hooks/pr-body-ref-gate.probe.sh   (from anywhere)

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/pr-body-ref-gate.sh"

TMPDIR_PROBE=$(mktemp -d)
cleanup() { rm -rf "$TMPDIR_PROBE"; }
trap cleanup EXIT

fail=0
OUT=""
RC=0

# Build a fresh fixture repo with a committed tracker/ tree, and register it
# as `origin/develop` via update-ref — no actual remote required.
make_repo() {
  local repo="$TMPDIR_PROBE/$1"
  mkdir -p "$repo/tracker/tasks" "$repo/tracker/archive/tasks" "$repo/tracker/docs"
  git -C "$repo" init -q
  git -C "$repo" config user.email probe@example.invalid
  git -C "$repo" config user.name probe
  echo "task" >"$repo/tracker/tasks/task-100 - Real Task.md"
  echo "archived" >"$repo/tracker/archive/tasks/task-112 - Archived Task.md"
  echo "doc" >"$repo/tracker/docs/doc-11 - Theme Doc.md"
  git -C "$repo" add -A
  git -C "$repo" commit -qm init
  git -C "$repo" update-ref refs/remotes/origin/develop HEAD
  printf '%s' "$repo"
}

# Fixture repo whose origin/develop tracker listing runs far past the 64 KB
# pipe buffer, with the referenced id sorting near the TOP of it — the shape
# that makes the resolver's pipeline race observable. `git ls-tree -r
# --name-only` sorts by path bytes and ` ` (0x20) precedes `0` (0x30), so
# `task-100 ` sorts ahead of every generated `task-1000 `+ filler and the real
# task-100 lands on row 2 of the listing. 800 filler files x a 150-char name
# gives a ~144 KB listing; the measurement behind that number is in the case
# comment below.
make_repo_large() {
  local repo="$TMPDIR_PROBE/$1"
  mkdir -p "$repo/tracker/tasks" "$repo/tracker/archive/tasks" "$repo/tracker/docs"
  git -C "$repo" init -q
  git -C "$repo" config user.email probe@example.invalid
  git -C "$repo" config user.name probe
  echo "task" >"$repo/tracker/tasks/task-100 - Real Task.md"
  echo "archived" >"$repo/tracker/archive/tasks/task-112 - Archived Task.md"
  echo "doc" >"$repo/tracker/docs/doc-11 - Theme Doc.md"
  local pad
  pad=$(printf 'a%.0s' {1..150})
  local i=0
  while [ "$i" -lt 800 ]; do
    echo "filler" >"$repo/tracker/tasks/task-$((1000 + i)) - $pad.md"
    # The doc listing is a SEPARATE pipeline in the resolver with the same
    # shape, so it gets the same treatment: filler ids start at 2000 so that
    # `doc-11 ` still sorts to the top (`1` < `2`; note `doc-1000 ` would have
    # sorted AHEAD of it, which is why the doc fillers do not start at 1000).
    echo "filler" >"$repo/tracker/docs/doc-$((2000 + i)) - $pad.md"
    i=$((i + 1))
  done
  git -C "$repo" add -A
  git -C "$repo" commit -qm init
  git -C "$repo" update-ref refs/remotes/origin/develop HEAD
  printf '%s' "$repo"
}

# Fixture repo with origin/develop but no tracker/ dir at all (empty-listing
# fail-open case).
make_repo_no_tracker() {
  local repo="$TMPDIR_PROBE/$1"
  mkdir -p "$repo"
  git -C "$repo" init -q
  git -C "$repo" config user.email probe@example.invalid
  git -C "$repo" config user.name probe
  echo "x" >"$repo/README.md"
  git -C "$repo" add -A
  git -C "$repo" commit -qm init
  git -C "$repo" update-ref refs/remotes/origin/develop HEAD
  printf '%s' "$repo"
}

# Run the hook from inside $1's cwd with a Bash command $2. Every call gets
# its OWN claim-scan ack path under $TMPDIR_PROBE (a fresh sequence number
# per call) so this probe never reads or writes the real
# /tmp/.claude_pr_body_claim_ack.<uid> file — the same "leak guard" intent as
# pr-merge-review-check.probe.sh's own ack-file isolation.
CLAIM_ACK_SEQ=0
run_hook() {
  local repo="$1"
  local cmd="$2"
  CLAIM_ACK_SEQ=$((CLAIM_ACK_SEQ + 1))
  local ack_file="$TMPDIR_PROBE/claim-ack-seq-$CLAIM_ACK_SEQ"
  OUT=$(jq -n --arg c "$cmd" '{tool_name:"Bash",tool_input:{command:$c}}' | (cd "$repo" && PR_BODY_CLAIM_ACK_FILE="$ack_file" "$HOOK") 2>&1)
  RC=$?
}

# Like run_hook, but reuses a caller-provided claim-ack path so a retry case
# can prove the SAME body is acked across two calls (run_hook's per-call
# sequence number would otherwise give each call a fresh, never-acked file).
run_hook_fixed_ack() { # $1=ack_file $2=repo $3=cmd
  local ack_file="$1"
  local repo="$2"
  local cmd="$3"
  OUT=$(jq -n --arg c "$cmd" '{tool_name:"Bash",tool_input:{command:$c}}' | (cd "$repo" && PR_BODY_CLAIM_ACK_FILE="$ack_file" "$HOOK") 2>&1)
  RC=$?
}

# Like run_hook, but prepends $1 onto PATH for just the hook invocation — used
# to shim out a binary (e.g. sha256sum) for exactly one call without touching
# the real PATH for jq, which runs OUTSIDE the subshell in this pipeline.
CLAIM_ACK_SEQ_PATH=0
run_hook_with_path() { # $1=path_prefix $2=repo $3=cmd
  local path_prefix="$1"
  local repo="$2"
  local cmd="$3"
  CLAIM_ACK_SEQ_PATH=$((CLAIM_ACK_SEQ_PATH + 1))
  local ack_file="$TMPDIR_PROBE/claim-ack-path-seq-$CLAIM_ACK_SEQ_PATH"
  OUT=$(jq -n --arg c "$cmd" '{tool_name:"Bash",tool_input:{command:$c}}' | (cd "$repo" && PATH="$path_prefix:$PATH" PR_BODY_CLAIM_ACK_FILE="$ack_file" "$HOOK") 2>&1)
  RC=$?
}

# Like run_hook, but reads the COMMAND from a file instead of passing it as an
# argument. An inline --body makes the command as large as the body, and Linux
# caps a single argv entry at 128 KB (MAX_ARG_STRLEN) whatever total ARG_MAX
# allows — below the command-detection pipeline's own SIGPIPE knee, so a
# past-the-buffer command cannot be passed to jq as an argument at all.
# `--rawfile` reads it from disk, removing that ceiling.
CLAIM_ACK_SEQ_CMDFILE=0
run_hook_cmd_file() { # $1=repo $2=file holding the command text
  local repo="$1"
  local cmd_file="$2"
  CLAIM_ACK_SEQ_CMDFILE=$((CLAIM_ACK_SEQ_CMDFILE + 1))
  local ack_file="$TMPDIR_PROBE/claim-ack-cmdfile-seq-$CLAIM_ACK_SEQ_CMDFILE"
  OUT=$(jq -n --rawfile c "$cmd_file" '{tool_name:"Bash",tool_input:{command:$c}}' | (cd "$repo" && PR_BODY_CLAIM_ACK_FILE="$ack_file" "$HOOK") 2>&1)
  RC=$?
}

assert_pass() { # $1 = label
  if [ "$RC" != 0 ]; then
    echo "FAIL [exit=$RC want=0]: $1"
    [ -n "$OUT" ] && printf '     got: %s\n' "$OUT"
    fail=1
  else
    echo "ok: $1"
  fi
}

assert_blocks() { # $1 = label, $2 = substring the message must carry
  if [ "$RC" != 2 ] || [[ "$OUT" != *"$2"* ]]; then
    echo "FAIL [exit=$RC want=2 | substr($2)=$([[ "$OUT" == *"$2"* ]] && echo yes || echo no)]: $1"
    [ -n "$OUT" ] && printf '     got: %s\n' "$OUT"
    fail=1
  else
    echo "ok: $1"
  fi
}

REPO=$(make_repo main)

# ---- Case 1: resolving TASK ref → pass --------------------------------------
run_hook "$REPO" 'gh pr create --base develop --title "feat: x" --body "Filed as TASK-100 for the follow-up."'
assert_pass "resolving TASK-100 passes"

# ---- Case 2: unresolved TASK ref → block ------------------------------------
run_hook "$REPO" 'gh pr create --base develop --title "feat: x" --body "Filed as TASK-99999 for the follow-up."'
assert_blocks "unresolved TASK-99999 blocks" "task-99999"

# ---- Case 3: non-PR command → pass -------------------------------------------
run_hook "$REPO" 'git status --porcelain'
assert_pass "non-PR command passes"

# ---- Case 4: --body-file with unresolved ref → block ------------------------
BODY_FILE="$TMPDIR_PROBE/body-unresolved.txt"
echo "Closes TASK-99999" >"$BODY_FILE"
run_hook "$REPO" "gh pr create --base develop --body-file $BODY_FILE"
assert_blocks "--body-file unresolved ref blocks" "task-99999"

# ---- Case 5: --body-file with resolving ref → pass --------------------------
# Rule 2 also flags a bare `Closes TASK-N` line, so this fixture carries an
# `## Acceptance` heading — the closing-reference narrowing's exemption —
# to keep testing what it was written for: rule 1's resolve-path, not
# rule 2's claim scan (that gets its own cases (d)/(e) below).
BODY_FILE2="$TMPDIR_PROBE/body-resolved.txt"
printf 'Closes TASK-100\n\n## Acceptance\n- done\n' >"$BODY_FILE2"
run_hook "$REPO" "gh pr create --base develop --body-file $BODY_FILE2"
assert_pass "--body-file resolving ref passes"

# ---- Case 6: resolving doc ref → pass ----------------------------------------
run_hook "$REPO" 'gh pr create --body "Tracked in doc-11."'
assert_pass "resolving doc-11 passes"

# ---- Case 7: unresolved doc ref → block --------------------------------------
run_hook "$REPO" 'gh pr create --body "Tracked in doc-99999."'
assert_blocks "unresolved doc-99999 blocks" "doc-99999"

# ---- Case 8: git broken → fail open ------------------------------------------
SHIM_DIR="$TMPDIR_PROBE/shim"
mkdir -p "$SHIM_DIR"
cat >"$SHIM_DIR/git" <<'EOF'
#!/bin/bash
exit 1
EOF
chmod +x "$SHIM_DIR/git"
OUT=$(jq -n --arg c 'gh pr create --base develop --title "feat: x" --body "Filed as TASK-99999 for the follow-up."' '{tool_name:"Bash",tool_input:{command:$c}}' | (cd "$REPO" && PATH="$SHIM_DIR:$PATH" PR_BODY_CLAIM_ACK_FILE="$TMPDIR_PROBE/claim-ack-brokengit" "$HOOK") 2>&1)
RC=$?
assert_pass "broken git fails open"

# ---- Case 9: no refs at all → pass -------------------------------------------
run_hook "$REPO" 'gh pr create --base develop --title "feat: x" --body "Adds a thing. No refs here."'
assert_pass "no refs passes"

# ---- Case 10: archived task resolves → pass ----------------------------------
# Carries a backticked path cite so rule 2's claim scan does not flag the
# bare `Closes TASK-112` line this case is not testing.
run_hook "$REPO" 'gh pr create --body "Closes TASK-112 (see `tracker/archive/tasks/task-112 - Archived Task.md`)."'
assert_pass "archived TASK-112 resolves"

# ---- Case 11: pnpm ops gh:pr-edit variant → block ----------------------------
run_hook "$REPO" 'pnpm ops gh:pr-edit 123 --body "Closes TASK-99999"'
assert_blocks "ops gh:pr-edit unresolved ref blocks" "task-99999"

# ---- Case 12: bare gh pr edit → block ----------------------------------------
run_hook "$REPO" 'gh pr edit 123 --body "Closes TASK-99999"'
assert_blocks "gh pr edit unresolved ref blocks" "task-99999"

# ---- Case 13: prefix collision (task-10 vs task-100) → block ----------------
run_hook "$REPO" 'gh pr create --body "Closes TASK-10."'
assert_blocks "TASK-10 prefix collision blocks (fixture has only task-100)" "task-10"

# ---- Case 14: --body-file pointing at missing path → pass (fail open) -------
run_hook "$REPO" "gh pr create --base develop --body-file $TMPDIR_PROBE/does-not-exist.txt"
assert_pass "--body-file missing path fails open"

# ---- Case 15: bare mention, no claim verb → pass -----------------------------
run_hook "$REPO" 'gh pr create --body "See TASK-99999 for background."'
assert_pass "bare mention with no claim verb passes"

# ---- Case 16: empty tracker/ listing → fail open -----------------------------
REPO_NOTRACKER=$(make_repo_no_tracker notracker)
run_hook "$REPO_NOTRACKER" 'gh pr create --base develop --title "feat: x" --body "Filed as TASK-99999 for the follow-up."'
assert_pass "empty tracker/ listing fails open"

# ---- Case 17: mixed refs, one resolves one doesn't → block ------------------
run_hook "$REPO" 'gh pr create --body "Closes TASK-100 and filed as TASK-99999."'
assert_blocks "mixed refs block on the unresolved one" "task-99999"

# ---- Case 18: case-insensitivity → block -------------------------------------
run_hook "$REPO" 'gh pr create --body "closes task-99999"'
assert_blocks "lowercase claim+id blocks" "task-99999"

# ---- Case 19: per-kind fail-open — empty tasks/, populated docs/ -------------
# The empty-listing skip must be PER KIND: with no task files on the ref but a
# populated docs/ listing, an unresolvable task id is skipped (fail-open) while
# the unresolved doc id is still checked against its own listing and blocks.
# An all-or-nothing fail-open would pass this command through entirely.
REPO_DOCSONLY="$TMPDIR_PROBE/docsonly"
mkdir -p "$REPO_DOCSONLY/tracker/docs"
git -C "$REPO_DOCSONLY" init -q
git -C "$REPO_DOCSONLY" config user.email probe@example.invalid
git -C "$REPO_DOCSONLY" config user.name probe
echo "doc" >"$REPO_DOCSONLY/tracker/docs/doc-11 - Theme Doc.md"
git -C "$REPO_DOCSONLY" add -A
git -C "$REPO_DOCSONLY" commit -qm init
git -C "$REPO_DOCSONLY" update-ref refs/remotes/origin/develop HEAD
run_hook "$REPO_DOCSONLY" 'gh pr create --body "Closes TASK-99999 and tracked in doc-99999."'
assert_blocks "empty tasks listing skips task id but doc id still blocks" "doc-99999"

# ---- Case 20: prose "--body-file" inside an inline --body → still scans -----
# The --body-file extraction runs over the WHOLE command, so prose naming the
# flag yields a junk path (`for`). An unreadable path must DEGRADE to scanning
# the command text, not abandon the claim scan — this case passed silently
# before that fix.
run_hook "$REPO" 'gh pr create --body "You can pass --body-file for large bodies. Closes TASK-99999."'
assert_blocks "prose --body-file mention still scans inline body" "task-99999"

# ---- Case 21: verb lookbehind — `discloses` is not `closes` -----------------
run_hook "$REPO" 'gh pr create --body "This discloses TASK-99999 to reviewers."'
assert_pass "discloses does not match the closes verb"

# ---- Case 22: id lookbehind — SUBTASK-99999 is not TASK-99999 ---------------
run_hook "$REPO" 'gh pr create --body "Closes SUBTASK-99999 upstream."'
assert_pass "SUBTASK-99999 does not match the TASK id"

# ---- Case 23: id lookbehind must not break wrapper chars -------------------
# The lookbehind sits after the `[\x60*_(\[]*` wrapper class, so a backticked
# id still matches. Uses the UNRESOLVED id so a silently-non-matching pattern
# would show up as a pass rather than hiding behind a resolving id.
run_hook "$REPO" 'gh pr create --body "Closes `TASK-99999`."'
assert_blocks "backticked id still matches through the lookbehind" "task-99999"

# ---- Case 24: >4 chained ids — the fifth is still extracted ----------------
# The `{0,3}` intervening-token window caps one span at ~4 ids; the chain tail
# is what carries the run past it. Only the FIFTH id is unresolved, so a
# missing tail fails open and this case passes instead of blocking.
run_hook "$REPO" 'gh pr create --body "Closes TASK-100, TASK-100, TASK-100, TASK-100, and TASK-99999."'
assert_blocks "fifth chained id is still checked" "task-99999"

# ---- Case 25: colon after the verb (GitHub `Closes: TASK-N` convention) -----
run_hook "$REPO" 'gh pr create --body "Closes: TASK-99999"'
assert_blocks "colon-suffixed claim verb still matches" "task-99999"

# ============================================================================
# Rule 2 (claim-shape scan) cases (a)-(h)
# ============================================================================

# ---- Case a: uncited count claim blocks, then an identical retry passes ----
ACK_A="$TMPDIR_PROBE/claim-ack-case-a"
BODY_FILE_A="$TMPDIR_PROBE/body-claim-count.txt"
echo "This fixes all 4 call sites." >"$BODY_FILE_A"
run_hook_fixed_ack "$ACK_A" "$REPO" "gh pr create --base develop --body-file $BODY_FILE_A"
assert_blocks "uncited count line blocks (rule 2)" "all 4 call sites"
run_hook_fixed_ack "$ACK_A" "$REPO" "gh pr create --base develop --body-file $BODY_FILE_A"
assert_pass "identical retry with the same ack file passes"

# ---- Case b: the same count claim, cited with a backticked grep → pass -----
BODY_FILE_B="$TMPDIR_PROBE/body-claim-count-cited.txt"
echo 'This fixes all 4 call sites (see `grep -rn fooBar src/`).' >"$BODY_FILE_B"
run_hook "$REPO" "gh pr create --base develop --body-file $BODY_FILE_B"
assert_pass "count line cited with a backticked grep passes on first try"

# ---- Case c: a hedged claim line passes ------------------------------------
BODY_FILE_C="$TMPDIR_PROBE/body-claim-hedged.txt"
echo "This updates every caller — not verified." >"$BODY_FILE_C"
run_hook "$REPO" "gh pr create --base develop --body-file $BODY_FILE_C"
assert_pass "hedged claim line passes"

# ---- Case d: closing reference to a RESOLVING task, no Acceptance heading --
# Rule 1 passes (TASK-100 resolves); rule 2 fires on the bare closing claim.
BODY_FILE_D="$TMPDIR_PROBE/body-claim-closes-no-accept.txt"
echo "Closes TASK-100." >"$BODY_FILE_D"
run_hook "$REPO" "gh pr create --base develop --body-file $BODY_FILE_D"
assert_blocks "closing reference with no Acceptance heading blocks (rule 2)" "Closes TASK-100."

# ---- Case e: same body plus an Acceptance heading → pass -------------------
BODY_FILE_E="$TMPDIR_PROBE/body-claim-closes-with-accept.txt"
printf 'Closes TASK-100.\n\n## Acceptance\n- done\n' >"$BODY_FILE_E"
run_hook "$REPO" "gh pr create --base develop --body-file $BODY_FILE_E"
assert_pass "closing reference exempted by an Acceptance heading"

# ---- Case f: gh api PATCH form with an uncited claim blocks ----------------
BODY_FILE_F="$TMPDIR_PROBE/body-claim-patch.txt"
echo "This is guaranteed to work." >"$BODY_FILE_F"
run_hook "$REPO" "gh api -X PATCH repos/o/r/pulls/12 -F body=@$BODY_FILE_F"
assert_blocks "gh api PATCH form with an uncited claim blocks" "guaranteed"

# ---- Case g: a claim inside a fenced code block is skipped -----------------
BODY_FILE_G="$TMPDIR_PROBE/body-claim-fenced.txt"
printf '```\nThis is guaranteed to always work.\n```\n' >"$BODY_FILE_G"
run_hook "$REPO" "gh pr create --base develop --body-file $BODY_FILE_G"
assert_pass "claim inside a fenced code block is skipped"

# ---- Case h: an unwritable claim-ack file fails open -----------------------
# `chmod 500` does not make a directory unwritable for root (root ignores
# directory write permission bits), so this case has no meaningful assertion
# to run under a root runner — skip it there rather than asserting a
# guarantee the fixture can't actually produce.
if [ "$(id -u)" -eq 0 ]; then
  echo "skip: unwritable-ack case needs a non-root runner"
else
  NO_WRITE_DIR="$TMPDIR_PROBE/no-write-dir"
  mkdir -p "$NO_WRITE_DIR"
  chmod 500 "$NO_WRITE_DIR"
  BODY_FILE_H="$TMPDIR_PROBE/body-claim-unwritable.txt"
  echo "This is guaranteed to work." >"$BODY_FILE_H"
  OUT=$(jq -n --arg c "gh pr create --base develop --body-file $BODY_FILE_H" '{tool_name:"Bash",tool_input:{command:$c}}' | (cd "$REPO" && PR_BODY_CLAIM_ACK_FILE="$NO_WRITE_DIR/ack" "$HOOK") 2>&1)
  RC=$?
  assert_pass "unwritable claim-ack file fails open"
  if [[ "$OUT" != *"failing open"* ]]; then
    echo "FAIL: expected a fail-open message on stderr"
    printf '     got: %s\n' "$OUT"
    fail=1
  else
    echo "ok: fail-open message present on stderr"
  fi
  chmod 700 "$NO_WRITE_DIR" 2>/dev/null || true
fi

# ---- Case i: colon-suffixed closing reference, no Acceptance heading ------
BODY_FILE_I2="$TMPDIR_PROBE/body-claim-colon-closes-no-accept.txt"
echo "Closes: TASK-100." >"$BODY_FILE_I2"
run_hook "$REPO" "gh pr create --base develop --body-file $BODY_FILE_I2"
assert_blocks "colon-suffixed closing reference with no Acceptance heading blocks (rule 2)" "Closes: TASK-100."

# ---- Case j: colon-suffixed closing reference, with Acceptance heading ----
BODY_FILE_J="$TMPDIR_PROBE/body-claim-colon-closes-with-accept.txt"
printf 'Closes: TASK-100.\n\n## Acceptance\n- done\n' >"$BODY_FILE_J"
run_hook "$REPO" "gh pr create --base develop --body-file $BODY_FILE_J"
assert_pass "colon-suffixed closing reference exempted by an Acceptance heading"

# ---- Case k: gh api PATCH form's lowercase -f body=@path is a LITERAL -----
# `-f`/`--raw-field` sends a literal string, so the body scanned is the text
# `@<path>`, which carries no claim; the file itself is never read. The
# fixture file still holds a claim so this case genuinely proves the file is
# not read (a false pass here would hide behind an empty fixture).
BODY_FILE_K="$TMPDIR_PROBE/body-claim-patch-lowercase-f.txt"
echo "This is guaranteed to work." >"$BODY_FILE_K"
run_hook "$REPO" "gh api -X PATCH repos/o/r/pulls/12 -f body=@$BODY_FILE_K"
assert_pass "gh api PATCH form's lowercase -f body=@path is a literal string, not a file ref"

# ---- Case k2: gh api PATCH form's -f body=<text> is an inline raw field ---
# An inline raw-field string still reaches rule 2.
run_hook "$REPO" 'gh api -X PATCH repos/o/r/pulls/12 -f body="all 4 call sites"'
assert_blocks "gh api PATCH form's -f body=<text> reaches rule 2" "all 4 call sites"

# ---- Case l: a nested blockquote line is skipped ---------------------------
BODY_FILE_L="$TMPDIR_PROBE/body-claim-nested-quote.txt"
echo ">> all 4 call sites" >"$BODY_FILE_L"
run_hook "$REPO" "gh pr create --base develop --body-file $BODY_FILE_L"
assert_pass "nested blockquote line is skipped"

# ---- Case m: an Acceptance heading inside a fenced block does not count ----
# The heading lives inside a fence, so has_acceptance must stay 0 — the bare
# closing reference after the fence is then unexempted and blocks.
BODY_FILE_M="$TMPDIR_PROBE/body-claim-fenced-acceptance.txt"
printf '```\n## Acceptance\n```\nCloses TASK-100\n' >"$BODY_FILE_M"
run_hook "$REPO" "gh pr create --base develop --body-file $BODY_FILE_M"
assert_blocks "fenced Acceptance heading does not exempt the closing reference" "Closes TASK-100"

# ---- Case n: `gh pr edit --body-file` pins rule-2 coverage for that family -
# The `gh api` family is already covered above (case f); this pins `gh pr
# edit --body-file`.
BODY_FILE_N="$TMPDIR_PROBE/body-claim-pr-edit-file.txt"
echo "This fixes all 4 call sites." >"$BODY_FILE_N"
run_hook "$REPO" "gh pr edit 12 --body-file $BODY_FILE_N"
assert_blocks "gh pr edit --body-file uncited claim blocks (rule 2)" "all 4 call sites"

# ---- Case o: `pnpm ops gh:pr-edit --body-file` pins rule-2 coverage --------
BODY_FILE_O="$TMPDIR_PROBE/body-claim-ops-pr-edit-file.txt"
echo "This fixes all 4 call sites." >"$BODY_FILE_O"
run_hook "$REPO" "pnpm ops gh:pr-edit 12 --body-file $BODY_FILE_O"
assert_blocks "pnpm ops gh:pr-edit --body-file uncited claim blocks (rule 2)" "all 4 call sites"

# ---- Case p: an INDENTED Acceptance heading still exempts a closing ref ----
# Mirrors the main loop's own leading-whitespace-tolerant heading skip.
BODY_FILE_P="$TMPDIR_PROBE/body-claim-indented-acceptance.txt"
printf 'Closes TASK-100.\n\n  ## Acceptance\n- done\n' >"$BODY_FILE_P"
run_hook "$REPO" "gh pr create --base develop --body-file $BODY_FILE_P"
assert_pass "indented Acceptance heading still exempts the closing reference"

# ============================================================================
# Rule 2 correction cases (i)-(iii): rule 2 scans ONLY the parsed PR body
# text (extract_pr_body), never the raw command string; and a heading line
# is a section label, not a claim.
# ============================================================================

# ---- Case i: a claim word in --title does not reach rule 2 (correction 1) --
BODY_FILE_I="$TMPDIR_PROBE/body-claim-title-only.txt"
echo "This is a clean description." >"$BODY_FILE_I"
run_hook "$REPO" "gh pr create --base develop --title \"fix: never retry on 4xx\" --body-file $BODY_FILE_I"
assert_pass "title-only claim word (never) does not reach rule 2"

# ---- Case ii: a bare 'verified' HEADING is not a claim (correction 2) ------
BODY_FILE_II="$TMPDIR_PROBE/body-claim-heading-only.txt"
printf 'Some intro line.\n\n## Verified, and how\n\nThis is normal text.\n' >"$BODY_FILE_II"
run_hook "$REPO" "gh pr create --base develop --body-file $BODY_FILE_II"
assert_pass "verified-only heading line is not a claim (rule 2)"

# ---- Case iii: an inline --body (no --body-file) still reaches rule 2 -----
ACK_III="$TMPDIR_PROBE/claim-ack-case-iii"
run_hook_fixed_ack "$ACK_III" "$REPO" 'gh pr create --base develop --body "all 4 call sites"'
assert_blocks "inline --body claim reaches rule 2" "all 4 call sites"
run_hook_fixed_ack "$ACK_III" "$REPO" 'gh pr create --base develop --body "all 4 call sites"'
assert_pass "identical inline-body retry with the same ack file passes"

# ---- Case q: gh api PATCH form's uppercase -F body="text" is inline text --
# `-F`/`--field` sends a literal string unless the value starts with `@`; a
# quoted, non-`@` value reaches rule 2 the same as `-f`.
run_hook "$REPO" 'gh api -X PATCH repos/o/r/pulls/12 -F body="all 4 call sites"'
assert_blocks "-F body= literal on the PATCH form reaches rule 2" "all 4 call sites"

# ---- Case r: a lowercase '## acceptance' heading still exempts a closing ref
BODY_FILE_R="$TMPDIR_PROBE/body-claim-lowercase-acceptance.txt"
printf 'Closes TASK-100.\n\n## acceptance\n- done\n' >"$BODY_FILE_R"
run_hook "$REPO" "gh pr create --base develop --body-file $BODY_FILE_R"
assert_pass "lowercase acceptance heading exempts the closing reference"

# ---- Case s: a backticked yarn command counts as a cite --------------------
# The command itself carries no `/` or `:`, so only the widened command
# alternative — not the path alternative — exempts this line.
BODY_FILE_S="$TMPDIR_PROBE/body-claim-yarn-cite.txt"
printf 'All 4 call sites updated; `yarn test` passes.\n' >"$BODY_FILE_S"
run_hook "$REPO" "gh pr create --base develop --body-file $BODY_FILE_S"
assert_pass "backticked yarn command counts as a cite"

# ---- Case t: -XPATCH concatenated form reaches rule 2 ----------------------
run_hook "$REPO" 'gh api -XPATCH repos/o/r/pulls/12 -F body="all 4 call sites"'
assert_blocks "-XPATCH concatenated form reaches rule 2" "all 4 call sites"

# ---- Case u: --field body= spelling reaches rule 2 --------------------------
run_hook "$REPO" 'gh api -X PATCH repos/o/r/pulls/12 --field body="all 4 call sites"'
assert_blocks "--field body= on the PATCH form reaches rule 2" "all 4 call sites"

# ---- Case v: a claim inside an INDENTED fenced block is skipped ------------
# Mirrors case g, but the fence markers themselves are indented under a list
# item — the fence toggle must key off the line with leading whitespace
# stripped, not the raw line, or the fence never closes and the claim inside
# it is scanned.
BODY_FILE_V="$TMPDIR_PROBE/body-claim-indented-fence.txt"
printf '  ```\n  all 4 call sites\n  ```\n' >"$BODY_FILE_V"
run_hook "$REPO" "gh pr create --base develop --body-file $BODY_FILE_V"
assert_pass "claim inside an indented fenced block is skipped"

# ---- Case w: claim scan fails open when sha256sum yields an EMPTY hash ----
# Without a hash there is no ack key, so the scan fails open rather than
# sharing one key across every body for the rest of the day.
# The shim below is an executable that exits non-zero, so `command -v` still
# FINDS it and the missing-binary branch is not the one exercised here — what
# runs is the empty-hash guard two lines below it. run_hook_with_path PREPENDS
# the shim dir onto the existing PATH, and a prepended dir cannot hide a binary
# from `command -v`, so the missing-binary branch is out of reach of THIS
# technique — reaching it would take replacing PATH outright with a directory
# that omits sha256sum. Both branches take the same `return 0`, so this case is
# the coverage for that behaviour either way.
SHA_SHIM_DIR="$TMPDIR_PROBE/sha-shim"
mkdir -p "$SHA_SHIM_DIR"
printf '#!/bin/bash\nexit 127\n' >"$SHA_SHIM_DIR/sha256sum"
chmod +x "$SHA_SHIM_DIR/sha256sum"
run_hook_with_path "$SHA_SHIM_DIR" "$REPO" 'gh pr create --base develop --body "all 4 call sites"'
assert_pass "claim scan fails open when sha256sum yields an empty hash"

# ---- Case x: CONTROL for cases y and z below -------------------------------
# The three cases here are one group: same endpoint, same `-f`, same inline
# value, same claim text. Only this one blocks; y and z each vary exactly ONE
# property from it and document a fail-open miss. Case f is NOT usable as that
# control — it passes the body by FILE reference (`-F body=@path`), so it
# differs from y and z in two properties at once, and a control that varies two
# properties cannot attribute a pass to the gap under test.
# Case k2 above is this exact shape already — same flag, same quoting, same
# PATCH form, differing only in body text. This case exists so the three-case
# group shares ONE claim string, which is what makes the single varied property
# visible at a glance.
run_hook "$REPO" 'gh api -X PATCH repos/o/r/pulls/12 -f body="This is guaranteed to work."'
assert_blocks "inline -f body= on the PATCH form blocks (control for the two gap cases below)" "guaranteed"

# ---- Case y: a whole-token-quoted field argument is a fail-open MISS -------
# Varies ONE property from case x: where the quote sits (`-f "body=…"` rather
# than `-f body="…"`). Documents a KNOWN GAP, not a desired behaviour — the
# required-flag check matches `body=` only where it directly follows the flag's
# whitespace, so a leading quote makes the hook exit before either rule runs.
# Behind that sits a second layer — extract_pr_body's inline-value patterns
# anchor the same way — so closing only the flag check leaves this case passing.
run_hook "$REPO" 'gh api -X PATCH repos/o/r/pulls/12 -f "body=This is guaranteed to work."'
assert_pass "whole-token-quoted -f \"body=…\" is a documented fail-open miss"

# ---- Case z: a shell-variable PR number is a fail-open MISS ----------------
# Varies ONE property from case x: the PR number, literal `12` becoming `$N`.
# Also a KNOWN GAP rather than a desired behaviour — IS_PATCH_PR_API anchors on
# `pulls/[0-9]+` against the unexpanded command text, so `pulls/$N` is never
# recognized as the PATCH family. Single-quoted here so `$N` stays literal in
# the command string the hook receives.
run_hook "$REPO" 'gh api -X PATCH repos/o/r/pulls/$N -f body="This is guaranteed to work."'
assert_pass "shell-variable PR number is a documented fail-open miss"

# ---- Case aa: early-sorting id on a listing past the pipe buffer -----------
# The resolver feeds the whole tracker listing into grep through a pipe. With
# `grep -q` the consumer exits on the first match while `printf` still has
# bytes to write, `printf` dies of SIGPIPE, and `set -o pipefail` turns a
# MATCH into a failed pipeline — so a resolvable id is reported MISSING. This
# case is the regression pin for the drained form.
#
# The fixture size was MEASURED against the `-q` resolver rather than guessed,
# 20 runs per size: 27 KB listing -> 0/20 blocked; 90 KB (about the real
# repo's own listing) -> 1/20, which is the roughly-1-percent rate that made
# this so hard to reproduce in the field; 112 KB -> 20/20; 144 KB -> 20/20 on
# two independent trials. make_repo_large builds the 144 KB size, past the
# knee with margin, so restoring `-q` reddens this case on the FIRST run
# instead of probabilistically. The ten runs below cost well under a second.
#
# The body says "Filed as" rather than "Closes" for a reason unrelated to this
# gate: "Closes TASK-100 …" is itself an uncited claim-shaped line, so it is
# blocked by the claim-shape rule before the reference resolver ever runs, and
# could never pass regardless of the pipeline fix. Case 1 uses the same shape.
REPO_LARGE=$(make_repo_large large)
large_rc=0
large_out=""
for _ in $(seq 1 10); do
  run_hook "$REPO_LARGE" 'gh pr create --base develop --title "feat: x" --body "Filed as TASK-100 for the follow-up."'
  if [ "$RC" != 0 ]; then
    large_rc="$RC"
    large_out="$OUT"
    break
  fi
done
RC="$large_rc"
OUT="$large_out"
assert_pass "early-sorting TASK-100 resolves on a past-the-pipe-buffer listing (10 runs)"

# ---- Case bb: the drain must not turn a genuine miss into a pass -----------
# Same large fixture, an id that is genuinely absent from the listing.
# Draining changes only WHICH process reports the pipeline's status, never
# whether the id matched; this assertion is what pins that, so it needs no
# canary of its own.
run_hook "$REPO_LARGE" 'gh pr create --base develop --title "feat: x" --body "Filed as TASK-99999 for the follow-up."'
assert_blocks "unresolved id on a past-the-pipe-buffer listing still blocks" "task-99999"

# ---- Case cc: the doc resolver is the same pipeline, so it gets the same pin
# The doc branch runs its own copy of the resolver pipeline over DOC_LIST and
# is vulnerable to exactly the same SIGPIPE race. Without this case the doc
# fix would be covered only by symmetry with the task fix — restoring `-q` on
# the doc line alone would redden nothing — so the same large fixture carries
# a past-the-buffer doc listing with doc-11 sorting to the top of it.
doc_rc=0
doc_out=""
for _ in $(seq 1 10); do
  run_hook "$REPO_LARGE" 'gh pr create --base develop --title "feat: x" --body "Filed as doc-11 for the follow-up."'
  if [ "$RC" != 0 ]; then
    doc_rc="$RC"
    doc_out="$OUT"
    break
  fi
done
RC="$doc_rc"
OUT="$doc_out"
assert_pass "early-sorting doc-11 resolves on a past-the-pipe-buffer doc listing (10 runs)"

# ---- Case dd: an Acceptance heading on a body past the pipe buffer ---------
# The acceptance-heading detector feeds the WHOLE unfenced body into grep. The
# heading is line 1 here, so with `-q` the consumer exits immediately while
# printf still has ~160 KB to write; printf dies of SIGPIPE, pipefail reports
# the match as a failure, has_acceptance stays 0, and the `Closes TASK-100.`
# line loses the exemption an Acceptance heading is supposed to grant — the
# gate blocks a body that should pass. The drained form is what makes this
# pass. This pipeline has its own knee, measured separately from case aa's:
# 112 KB -> 0/20 runs raced, 128 KB -> 20/20. The fixture is ~160 KB, past it.
# The filler is a few very wide lines rather than many narrow ones on purpose:
# the race needs BYTES past the pipe buffer, while the claim scan's cost is per
# LINE, so wide-and-few keeps this case an order of magnitude cheaper.
BODY_FILE_DD="$TMPDIR_PROBE/body-dd.md"
{
  echo '## Acceptance'
  echo 'Closes TASK-100.'
  dd_pad=$(printf 'x %.0s' {1..4000})
  dd_i=0
  while [ "$dd_i" -lt 20 ]; do
    echo "$dd_pad"
    dd_i=$((dd_i + 1))
  done
} >"$BODY_FILE_DD"
dd_rc=0
dd_out=""
for _ in $(seq 1 5); do
  run_hook "$REPO" "gh pr create --base develop --body-file $BODY_FILE_DD"
  if [ "$RC" != 0 ]; then
    dd_rc="$RC"
    dd_out="$OUT"
    break
  fi
done
RC="$dd_rc"
OUT="$dd_out"
assert_pass "Acceptance heading exempts the closing reference on a past-the-pipe-buffer body (5 runs)"

# ---- Case ee: command-family detection on a command past the pipe buffer ---
# The `gh … pr create|edit` detector greps the whole DECODED COMMAND, and an
# inline --body makes that command as large as the body. `gh pr create` sits
# at byte 0, so with `-q` grep exits at once, printf dies of SIGPIPE, and the
# negated pipeline reads as "not a PR command" — the gate exits 0 and fails
# OPEN on a body carrying an unresolvable id. Drained, it blocks every run.
#
# This pipeline's knee was measured separately from case aa's and sits higher:
# 112 KB -> 0/20 runs raced, 120 KB -> 1/20, 128 KB -> 20/20 on two trials.
# The fixture is ~144 KB, past that with margin, so restoring `-q` reddens
# this case on the FIRST run. The command reaches the hook from a FILE rather
# than an argument: one argv entry is capped at 128 KB, which is BELOW this
# pipeline's knee, so an argument-passed command could never be deterministic.
CMD_FILE_EE="$TMPDIR_PROBE/cmd-ee.txt"
{
  printf '%s' 'gh pr create --base develop --title "feat: x" --body "Filed as TASK-99999 for the follow-up.'
  ee_pad=$(printf 'x %.0s' {1..4000})
  ee_i=0
  while [ "$ee_i" -lt 18 ]; do
    printf '\n%s' "$ee_pad"
    ee_i=$((ee_i + 1))
  done
  printf '%s' '"'
} >"$CMD_FILE_EE"
ee_rc=0
ee_out=""
for _ in $(seq 1 5); do
  run_hook_cmd_file "$REPO" "$CMD_FILE_EE"
  if [ "$RC" = 0 ]; then
    ee_rc="$RC"
    ee_out="$OUT"
    break
  fi
  ee_rc="$RC"
  ee_out="$OUT"
done
RC="$ee_rc"
OUT="$ee_out"
assert_blocks "unresolved id still detected on a past-the-pipe-buffer command (5 runs)" "task-99999"

exit $fail
