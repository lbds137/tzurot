#!/bin/bash
# Fixture check for tracker-dirty-push-gate.sh — run after ANY edit to the hook.
#
# The hook decides ONE thing: block the push when tracker/ has uncommitted or
# untracked files (unless bypassed). Every case runs it inside a THROWAWAY git
# repo built here — the probe never reads or mutates the real repository, so a
# dirty real-world tracker/ cannot flip a probe result and vice versa.
#
# Usage: .claude/hooks/tracker-dirty-push-gate.probe.sh   (from anywhere)

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/tracker-dirty-push-gate.sh"

TMPDIR_PROBE=$(mktemp -d)
cleanup() { rm -rf "$TMPDIR_PROBE"; }
trap cleanup EXIT

fail=0
OUT=""
RC=0

# Build a fresh fixture repo with a committed tracker/ file. $1 = name.
make_repo() {
    local repo="$TMPDIR_PROBE/$1"
    mkdir -p "$repo/tracker/tasks"
    git -C "$repo" init -q
    git -C "$repo" config user.email probe@example.invalid
    git -C "$repo" config user.name probe
    echo "committed task" >"$repo/tracker/tasks/task-1 - Committed.md"
    git -C "$repo" add -A
    git -C "$repo" commit -qm init
    printf '%s' "$repo"
}

# Run the hook from inside $1 (cwd is how the hook finds the repo root).
run_hook() {
    OUT=$(cd "$1" && "$HOOK" 2>&1)
    RC=$?
}

assert_pass() { # $1 = label
    if [ "$RC" != 0 ] || [ -n "${OUT//[[:space:]]/}" ]; then
        echo "FAIL [exit=$RC want=0 | output=$([ -n "${OUT//[[:space:]]/}" ] && echo present || echo empty) want=empty]: $1"
        [ -n "$OUT" ] && printf '     got: %s\n' "$OUT"
        fail=1
    else
        echo "ok: $1"
    fi
}

assert_blocks() { # $1 = label, $2 = substring the message must carry
    if [ "$RC" != 1 ] || [[ "$OUT" != *"Uncommitted tracker/"* ]] || [[ "$OUT" != *"$2"* ]]; then
        echo "FAIL [exit=$RC want=1 | banner=$([[ "$OUT" == *"Uncommitted tracker/"* ]] && echo yes || echo no) | substr($2)=$([[ "$OUT" == *"$2"* ]] && echo yes || echo no)]: $1"
        [ -n "$OUT" ] && printf '     got: %s\n' "$OUT"
        fail=1
    else
        echo "ok: $1"
    fi
}

# ---- Case 1: clean tracker/ → pass ------------------------------------------
REPO=$(make_repo clean)
run_hook "$REPO"
assert_pass "clean tracker/ passes"

# ---- Case 2: untracked task file → block, message names it ------------------
REPO=$(make_repo untracked)
echo "new" >"$REPO/tracker/tasks/task-2 - Fresh.md"
run_hook "$REPO"
assert_blocks "untracked task file blocks" "task-2 - Fresh.md"

# ---- Case 3: modified tracked file → block ----------------------------------
REPO=$(make_repo modified)
echo "edited" >>"$REPO/tracker/tasks/task-1 - Committed.md"
run_hook "$REPO"
assert_blocks "modified tracked file blocks" "task-1 - Committed.md"

# ---- Case 4: staged but uncommitted → still blocks (staged ≠ committed) -----
REPO=$(make_repo staged)
echo "staged" >"$REPO/tracker/tasks/task-3 - Staged.md"
git -C "$REPO" add tracker/
run_hook "$REPO"
assert_blocks "staged-but-uncommitted blocks" "task-3 - Staged.md"

# ---- Case 5: bypass env var → pass despite dirt -----------------------------
REPO=$(make_repo bypass)
echo "new" >"$REPO/tracker/tasks/task-4 - Bypassed.md"
OUT=$(cd "$REPO" && TZUROT_ALLOW_UNCOMMITTED_TRACKER=1 "$HOOK" 2>&1)
RC=$?
assert_pass "TZUROT_ALLOW_UNCOMMITTED_TRACKER=1 bypasses"

# ---- Case 6: dirt OUTSIDE tracker/ only → pass (gate is tracker-scoped) -----
REPO=$(make_repo elsewhere)
echo "wip" >"$REPO/unrelated.ts"
run_hook "$REPO"
assert_pass "dirt outside tracker/ does not block"

# ---- Case 7: repo without a tracker/ dir → pass (fail open) -----------------
REPO="$TMPDIR_PROBE/notracker"
mkdir -p "$REPO"
git -C "$REPO" init -q
run_hook "$REPO"
assert_pass "repo without tracker/ passes"

# ---- Case 8: not a git repo at all → pass (fail open) -----------------------
NOREPO="$TMPDIR_PROBE/norepo"
mkdir -p "$NOREPO"
OUT=$(cd "$NOREPO" && GIT_CEILING_DIRECTORIES="$TMPDIR_PROBE" "$HOOK" 2>&1)
RC=$?
assert_pass "outside any git repo passes (fail open)"

exit $fail
