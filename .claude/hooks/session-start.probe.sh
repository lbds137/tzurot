#!/bin/bash
# Fixture check for session-start.sh — run after ANY edit to the hook.
#
# The hook decides two things: which block the `source` field selects, and — on
# the non-compact branch — whether to print the overdue-cadence block from the
# `pnpm ops cadence:status --overdue-only` result. Every case runs the hook
# against a THROWAWAY project dir with a stub `pnpm` first on PATH, so the probe
# never boots the real CLI or reads the real ledger.
#
# Usage: .claude/hooks/session-start.probe.sh   (from anywhere)

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/session-start.sh"

TMPDIR_PROBE=$(mktemp -d)
cleanup() { rm -rf "$TMPDIR_PROBE"; }
trap cleanup EXIT

fail=0
OUT=""
RC=0

HEADER="=== Overdue periodic passes"
UNAVAILABLE="(cadence status unavailable"
OVERDUE_ROW="usage-audit  7d  2026-08-26  20  OVERDUE 13d  /tzurot-usage-audit"
ORPHAN_HEADER="=== Orphans from earlier sessions"

# Stub preamble: record the invocation, then refuse (exit 9x) unless the hook
# called it the way it must — from the project root, with dotenv quieted, with
# the exact overdue-only argv. A refusal surfaces as the unavailable line, so a
# drifted invocation cannot pass the row/empty cases.
STUB_GUARD='touch "$(dirname "$0")/invoked"
[ -f CURRENT.md ] || exit 95
[ "${DOTENV_CONFIG_QUIET:-}" = true ] || exit 96
[ "$*" = "-s ops cadence:status --overdue-only" ] || exit 97'

# Build a project dir with a CURRENT.md and a stub pnpm. $1 = name, $2 = stub tail.
make_fixture() {
    local dir="$TMPDIR_PROBE/$1"
    mkdir -p "$dir/bin"
    echo "CURRENT-MARKER" >"$dir/CURRENT.md"
    printf '#!/bin/bash\n%s\n%s\n' "$STUB_GUARD" "$2" >"$dir/bin/pnpm"
    chmod +x "$dir/bin/pnpm"
    printf '#!/bin/bash\nexit 1\n' >"$dir/bin/pgrep"
    chmod +x "$dir/bin/pgrep"
    printf '%s' "$dir"
}

# Run the hook with $2 as the SessionStart source against fixture $1. The cwd is
# deliberately NOT the fixture, so the hook's own `cd "$ROOT"` is what the stub's
# CURRENT.md check observes.
run_hook() {
    OUT=$(cd "$TMPDIR_PROBE" && printf '{"source":"%s"}' "$2" \
        | CLAUDE_PROJECT_DIR="$1" PATH="$1/bin:$PATH" "$HOOK" 2>&1)
    RC=$?
}

expect() { # $1 = label, $2 = present|absent, $3 = substring
    local found=no
    [[ "$OUT" == *"$3"* ]] && found=yes
    if [ "$RC" != 0 ] || { [ "$2" = present ] && [ "$found" = no ]; } || { [ "$2" = absent ] && [ "$found" = yes ]; }; then
        echo "FAIL [exit=$RC want=0 | '$3' found=$found want=$2]: $1"
        printf '     got: %s\n' "$OUT"
        fail=1
    else
        echo "ok: $1"
    fi
}

# ---- Case a: compact source → checklist only, cadence never queried ----------
DIR=$(make_fixture compact "echo \"$OVERDUE_ROW\"")
run_hook "$DIR" compact
expect "compact prints the recovery checklist" present "POST-COMPACTION RECOVERY"
expect "compact prints no cadence block" absent "$HEADER"
expect "compact prints no CURRENT.md" absent "CURRENT-MARKER"
if [ -e "$DIR/bin/invoked" ]; then
    echo "FAIL: compact invoked pnpm (the cadence query must stay on the non-compact branch)"
    fail=1
else
    echo "ok: compact never invokes pnpm"
fi

# ---- Case b: stub prints an overdue row → header and row appear --------------
DIR=$(make_fixture overdue "echo \"$OVERDUE_ROW\"")
run_hook "$DIR" startup
expect "startup still injects CURRENT.md" present "CURRENT-MARKER"
expect "overdue result prints the header" present "$HEADER"
expect "overdue result prints the row" present "$OVERDUE_ROW"
expect "a correct invocation is not reported unavailable" absent "$UNAVAILABLE"

# ---- Case c: stub prints nothing → no header ----------------------------------
DIR=$(make_fixture empty "exit 0")
run_hook "$DIR" resume
expect "empty result prints no header" absent "$HEADER"
expect "empty result is not reported unavailable" absent "$UNAVAILABLE"

# ---- Case d: stub exits non-zero → the unavailable line appears ---------------
DIR=$(make_fixture failing "echo partial-row; exit 1")
run_hook "$DIR" startup
expect "failing command prints the header" present "$HEADER"
expect "failing command prints the unavailable line" present "$UNAVAILABLE"
expect "failing command's partial stdout is not shown" absent "partial-row"

# ---- Case e/f: orphan reconciliation ------------------------------------------
# A real git repo with a real worktree under .claude/worktrees/, plus a bare
# remote so "unpushed" is a SMALLER number than the repo's total commit count —
# that gap is what pins the `--not --remotes` semantics.
setup_repo() {
    local dir="$1"
    git init -q "$dir"
    git -C "$dir" config user.email probe@example.com
    git -C "$dir" config user.name Probe
    git -C "$dir" commit -q --allow-empty -m base
    local remote="$TMPDIR_PROBE/remote-$(basename "$dir").git"
    git init -q --bare "$remote"
    git -C "$dir" remote add origin "$remote"
    git -C "$dir" push -q origin HEAD
}

DIR=$(make_fixture noorphan "exit 0")
setup_repo "$DIR"
run_hook "$DIR" startup
expect "a repo with no agent worktree prints no orphan section" absent "$ORPHAN_HEADER"

DIR=$(make_fixture orphan "exit 0")
setup_repo "$DIR"
git -C "$DIR" worktree add -q -b probe-agent "$DIR/.claude/worktrees/agent-probe"
git -C "$DIR/.claude/worktrees/agent-probe" commit -q --allow-empty -m unpushed
touch "$DIR/.claude/worktrees/agent-probe/dirty-file"
run_hook "$DIR" startup
expect "an agent worktree is listed" present "agent-probe"
expect "its dirty count is reported" present "dirty=1"
expect "its unpushed count excludes what the remote already has" present "unpushed=1"

# A worktree OUTSIDE .claude/worktrees/ is somebody's ordinary checkout, not an
# agent leftover — the path filter, not the self-exclusion, is what drops it.
DIR=$(make_fixture plainwt "exit 0")
setup_repo "$DIR"
git -C "$DIR" worktree add -q -b plain-branch "$DIR/sidecar"
run_hook "$DIR" startup
expect "a worktree outside .claude/worktrees/ is not reported" absent "$ORPHAN_HEADER"

DIR=$(make_fixture waiter "exit 0")
setup_repo "$DIR"
printf '#!/bin/bash\necho "4242 bash -c ci-gate-waiter-decoy"\n' >"$DIR/bin/pgrep"
run_hook "$DIR" startup
expect "a surviving waiter is listed by exact pid" present "waiter pid 4242"

exit $fail
