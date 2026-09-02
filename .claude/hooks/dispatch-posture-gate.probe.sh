#!/bin/bash
# Fixture check for dispatch-posture-gate.sh — run after ANY edit to the hook.
#
# Builds a throwaway CLAUDE_PROJECT_DIR fixture and a throwaway ack file
# (via DISPATCH_POSTURE_ACK_FILE) so the probe never reads or mutates the
# real repo's ack state. Each case that needs a "fresh ack" starts from an
# empty/absent ack file.
#
# Usage: .claude/hooks/dispatch-posture-gate.probe.sh   (from anywhere)

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/dispatch-posture-gate.sh"

TMPDIR_PROBE=$(mktemp -d)
cleanup() { rm -rf "$TMPDIR_PROBE"; }
trap cleanup EXIT

FIXTURE="$TMPDIR_PROBE/fixture"
mkdir -p "$FIXTURE/services/x" "$FIXTURE/packages/y" "$FIXTURE/docs" "$FIXTURE/.claude/worktrees/w1/services/x"

FAILURES=0

# run <expected-exit> <label> <tool_name> <file_path> <ack_file> [project_dir]
run() {
  local expected="$1" label="$2" tool="$3" path="$4" ack="$5" project="${6:-$FIXTURE}"
  jq -n --arg t "$tool" --arg p "$path" '{tool_name:$t,tool_input:{file_path:$p}}' \
    | CLAUDE_PROJECT_DIR="$project" DISPATCH_POSTURE_ACK_FILE="$ack" "$HOOK" >/dev/null 2>&1
  local actual=$?
  if [ "$actual" -eq "$expected" ]; then
    printf 'PASS  (exit %d)  %s\n' "$actual" "$label"
  else
    printf 'FAIL  (exit %d, expected %d)  %s\n' "$actual" "$expected" "$label"
    FAILURES=$((FAILURES + 1))
  fi
}

# --- case 1: fresh ack, Edit to a services/*.ts path → blocks ---------------
ACK1="$TMPDIR_PROBE/ack1"
run 2 "fresh ack: Edit to services/x/a.ts" "Edit" "$FIXTURE/services/x/a.ts" "$ACK1"

# --- case 2: same call again, now acked → passes -----------------------------
run 0 "same call again (acked) passes" "Edit" "$FIXTURE/services/x/a.ts" "$ACK1"

# --- case 2b: a NEW COMMIT re-arms the gate (HEAD is part of the ack key) ----
# A review-round fix is by construction a post-commit edit; a per-day key
# lets one build's ack silently cover every later review round on the branch.
# Needs a real git fixture: the cases above run un-repo'd (HEAD → "nohead").
GITFIX="$TMPDIR_PROBE/gitfix"
mkdir -p "$GITFIX/services/x"
git -C "$GITFIX" init -q -b probe
git -C "$GITFIX" -c user.email=probe@probe -c user.name=probe commit -q --allow-empty -m one
ACK2B="$TMPDIR_PROBE/ack2b"
run 2 "git fixture: fresh ack blocks" "Edit" "$GITFIX/services/x/a.ts" "$ACK2B" "$GITFIX"
run 0 "git fixture: same HEAD acked passes" "Edit" "$GITFIX/services/x/a.ts" "$ACK2B" "$GITFIX"
git -C "$GITFIX" -c user.email=probe@probe -c user.name=probe commit -q --allow-empty -m two
run 2 "git fixture: NEW COMMIT re-arms the block" "Edit" "$GITFIX/services/x/a.ts" "$ACK2B" "$GITFIX"

# --- case 3: worktree-exempt path → passes -----------------------------------
ACK3="$TMPDIR_PROBE/ack3"
run 0 "worktree-exempt path passes" "Edit" "$FIXTURE/.claude/worktrees/w1/services/x/a.ts" "$ACK3"

# --- case 4: docs path → passes (not services|packages) ----------------------
ACK4="$TMPDIR_PROBE/ack4"
run 0 "docs/a.md passes" "Edit" "$FIXTURE/docs/a.md" "$ACK4"

# --- case 5: Write tool, fresh ack, packages/*.ts → blocks -------------------
ACK5="$TMPDIR_PROBE/ack5"
run 2 "fresh ack: Write to packages/y/b.ts" "Write" "$FIXTURE/packages/y/b.ts" "$ACK5"

# --- case 5b: .mjs under packages/ is gated too --------------------------------
ACK5B="$TMPDIR_PROBE/ack5b"
run 2 "fresh ack: Edit to packages/y/c.mjs" "Edit" "$FIXTURE/packages/y/c.mjs" "$ACK5B"

# --- case 5c: MultiEdit is gated like Edit/Write -------------------------------
# MultiEdit is merged into Edit in current Claude Code but remains a distinct
# tool_name in older harness versions (settings.json permissions still list
# it); gating it is harmless when dead, protective when alive.
ACK5C="$TMPDIR_PROBE/ack5c"
run 2 "fresh ack: MultiEdit to services/x/a.ts" "MultiEdit" "$FIXTURE/services/x/a.ts" "$ACK5C"

# --- case 6: tool_name = Bash → passes ----------------------------------------
ACK6="$TMPDIR_PROBE/ack6"
run 0 "tool_name=Bash passes" "Bash" "$FIXTURE/services/x/a.ts" "$ACK6"

# --- case 7: path outside the fixture root → passes ---------------------------
ACK7="$TMPDIR_PROBE/ack7"
run 0 "path outside fixture root passes" "Edit" "/some/other/root/services/x/a.ts" "$ACK7"

# --- case 8: the worktree IS the project root → passes ------------------------
# The real shape of the worktree exemption: a dispatched worker runs with
# CLAUDE_PROJECT_DIR set to its own worktree, so the path's project-relative
# form is a plain `services/...` and only the ABSOLUTE-path check can exempt
# it. Case 3 exits earlier (its relative form starts with `.claude/`), so
# without this case the exemption branch can be deleted with the probe still
# fully green.
WT_ROOT="$TMPDIR_PROBE/main/.claude/worktrees/agent-1"
mkdir -p "$WT_ROOT/services/x"
ACK8="$TMPDIR_PROBE/ack8"
jq -n '{tool_name:"Edit",tool_input:{file_path:"services/x/a.ts"}}' \
  | CLAUDE_PROJECT_DIR="$WT_ROOT" DISPATCH_POSTURE_ACK_FILE="$ACK8" "$HOOK" >/dev/null 2>&1
ACTUAL8=$?
if [ "$ACTUAL8" -eq 0 ]; then
  printf 'PASS  (exit %d)  %s\n' "$ACTUAL8" "worktree AS project root passes"
else
  printf 'FAIL  (exit %d, expected 0)  %s\n' "$ACTUAL8" "worktree AS project root passes"
  FAILURES=$((FAILURES + 1))
fi

# === size measurement (the 5-line inline exemption, measured) ================
# The cases above pass no old_string/new_string, so they measure 0 lines and
# exercise the ack path. These drive the size branch, which sits BEFORE the ack
# logic: over five touched lines is a hard block with no ack recorded, so the
# retry blocks too.

# lines <n> — a string of n newline-separated lines, with NO trailing newline.
lines() {
  local n="$1" i out=""
  for ((i = 1; i <= n; i++)); do out+="line $i"$'\n'; done
  printf '%s' "${out%$'\n'}"
}

# lines_nl <n> <varname> — the same n lines, but WITH a trailing newline. This
# is the ordinary shape of a block copied out of a file, and the count must not
# treat that final newline as a sixth line.
#
# It assigns to the variable NAMED by $2 rather than writing to stdout: command
# substitution strips every trailing newline, so a `$(lines_nl 5)` call site
# would silently receive the no-trailing-newline shape and test nothing.
lines_nl() {
  printf -v "$2" '%s\n' "$(lines "$1")"
}

# run_sized <expected-exit> <label> <payload-json> <ack_file> [project_dir]
run_sized() {
  local expected="$1" label="$2" payload="$3" ack="$4" project="${5:-$FIXTURE}"
  printf '%s' "$payload" \
    | CLAUDE_PROJECT_DIR="$project" DISPATCH_POSTURE_ACK_FILE="$ack" "$HOOK" >/dev/null 2>&1
  local actual=$?
  if [ "$actual" -eq "$expected" ]; then
    printf 'PASS  (exit %d)  %s\n' "$actual" "$label"
  else
    printf 'FAIL  (exit %d, expected %d)  %s\n' "$actual" "$expected" "$label"
    FAILURES=$((FAILURES + 1))
  fi
}

edit_payload() {
  jq -cn --arg p "$1" --arg o "$2" --arg n "$3" \
    '{tool_name:"Edit",tool_input:{file_path:$p,old_string:$o,new_string:$n}}'
}

SRC="$FIXTURE/services/x/a.ts"

# --- case i: a 3-line Edit → blocks once, passes on retry (ack path) ---------
ACK_I="$TMPDIR_PROBE/ack_i"
P_I=$(edit_payload "$SRC" "$(lines 3)" "$(lines 3)")
run_sized 2 "3-line Edit: blocks once (ack path)" "$P_I" "$ACK_I"
run_sized 0 "3-line Edit: retry passes (acked)" "$P_I" "$ACK_I"

# --- case i-b: exactly 5 lines is INSIDE the exemption -----------------------
ACK_IB="$TMPDIR_PROBE/ack_ib"
P_IB=$(edit_payload "$SRC" "$(lines 5)" "$(lines 5)")
run_sized 2 "5-line Edit: blocks once (still the ack path)" "$P_IB" "$ACK_IB"
run_sized 0 "5-line Edit: retry passes (boundary is >5, not >=5)" "$P_IB" "$ACK_IB"

# --- case i-c: 6 lines is the first over-size value --------------------------
ACK_IC="$TMPDIR_PROBE/ack_ic"
P_IC=$(edit_payload "$SRC" "$(lines 6)" "$(lines 6)")
run_sized 2 "6-line Edit: hard block" "$P_IC" "$ACK_IC"
run_sized 2 "6-line Edit: retry blocks AGAIN (no ack)" "$P_IC" "$ACK_IC"

# --- case i-d: 5 lines WITH a trailing newline is still inside the exemption -
ACK_ID="$TMPDIR_PROBE/ack_id"
lines_nl 5 FIVE_NL
P_ID=$(edit_payload "$SRC" "$FIVE_NL" "$FIVE_NL")
run_sized 2 "5-line Edit + trailing newline: blocks once (ack path)" "$P_ID" "$ACK_ID"
run_sized 0 "5-line Edit + trailing newline: retry passes (not counted as 6)" "$P_ID" "$ACK_ID"

# --- case i-e: 6 lines with a trailing newline is still the first over-size --
ACK_IE="$TMPDIR_PROBE/ack_ie"
lines_nl 6 SIX_NL
P_IE=$(edit_payload "$SRC" "$SIX_NL" "$SIX_NL")
run_sized 2 "6-line Edit + trailing newline: hard block" "$P_IE" "$ACK_IE"
run_sized 2 "6-line Edit + trailing newline: retry blocks AGAIN (no ack)" "$P_IE" "$ACK_IE"

# --- case ii: a 20-line Edit → blocks, and blocks again on retry -------------
ACK_II="$TMPDIR_PROBE/ack_ii"
P_II=$(edit_payload "$SRC" "$(lines 20)" "$(lines 20)")
run_sized 2 "20-line Edit: hard block" "$P_II" "$ACK_II"
run_sized 2 "20-line Edit: retry blocks AGAIN (no ack recorded)" "$P_II" "$ACK_II"

# --- case ii-b: size is the MAX of old/new, not either alone -----------------
# A 20-line insertion has no old text; a 20-line deletion has no new text.
ACK_IIB="$TMPDIR_PROBE/ack_iib"
run_sized 2 "20-line pure insertion (empty old_string): hard block" \
  "$(edit_payload "$SRC" "" "$(lines 20)")" "$ACK_IIB"
ACK_IIC="$TMPDIR_PROBE/ack_iic"
run_sized 2 "20-line pure deletion (empty new_string): hard block" \
  "$(edit_payload "$SRC" "$(lines 20)" "")" "$ACK_IIC"

# --- case iii: a Write of 40 lines → blocks twice ----------------------------
ACK_III="$TMPDIR_PROBE/ack_iii"
P_III=$(jq -cn --arg p "$FIXTURE/packages/y/b.ts" --arg c "$(lines 40)" \
  '{tool_name:"Write",tool_input:{file_path:$p,content:$c}}')
run_sized 2 "40-line Write: hard block" "$P_III" "$ACK_III"
run_sized 2 "40-line Write: retry blocks AGAIN" "$P_III" "$ACK_III"

# --- case iii-b: MultiEdit sums its edits over the limit ---------------------
# Three 3-line edits are each inside the exemption; together they are not.
ACK_IIIB="$TMPDIR_PROBE/ack_iiib"
P_IIIB=$(jq -cn --arg p "$SRC" --arg s "$(lines 3)" \
  '{tool_name:"MultiEdit",tool_input:{file_path:$p,
     edits:[{old_string:$s,new_string:$s},{old_string:$s,new_string:$s},{old_string:$s,new_string:$s}]}}')
run_sized 2 "MultiEdit 3x3 lines (sum 9): hard block" "$P_IIIB" "$ACK_IIIB"
run_sized 2 "MultiEdit 3x3 lines: retry blocks AGAIN" "$P_IIIB" "$ACK_IIIB"

# --- case iv: the worktree-path exemption still wins over a 20-line edit -----
# The size branch must sit AFTER the scope checks, not before them.
ACK_IV="$TMPDIR_PROBE/ack_iv"
run_sized 0 "20-line Edit under .claude/worktrees/ still passes" \
  "$(edit_payload "$FIXTURE/.claude/worktrees/w1/services/x/a.ts" "$(lines 20)" "$(lines 20)")" \
  "$ACK_IV"

# --- case iv-b: a 20-line docs edit is still out of scope --------------------
ACK_IVB="$TMPDIR_PROBE/ack_ivb"
run_sized 0 "20-line Edit to docs/a.md still passes (out of scope)" \
  "$(edit_payload "$FIXTURE/docs/a.md" "$(lines 20)" "$(lines 20)")" "$ACK_IVB"

# --- case iv-c: the worktree AS project root, over-size → still passes -------
ACK_IVC="$TMPDIR_PROBE/ack_ivc"
run_sized 0 "20-line Edit with the worktree AS project root passes" \
  "$(jq -cn --arg o "$(lines 20)" --arg n "$(lines 20)" \
    '{tool_name:"Edit",tool_input:{file_path:"services/x/a.ts",old_string:$o,new_string:$n}}')" \
  "$ACK_IVC" "$WT_ROOT"

exit $FAILURES
