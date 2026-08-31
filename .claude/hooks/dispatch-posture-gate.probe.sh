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

exit $FAILURES
