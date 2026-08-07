#!/bin/bash
# Fixture check for claim-shape-guard.sh — run after ANY edit to the hook.
# Asserts the fire/silent table over the shapes that matter: a claim-shaped
# line STAGED in a code file fires; the same line under an excluded meta path
# (tracker/, backlog/, docs/, .claude/) or in any *.md stays silent; a staged
# change with no claim shapes stays silent; an empty index stays silent.
#
# The hook reads real git state (`git diff --cached`), so the fixtures are
# staged changes in a THROWAWAY repo under $(mktemp -d) pointed at by
# CLAUDE_PROJECT_DIR — the probe never touches this repo's index.
#
# The hook runs from .husky/pre-commit and takes NO stdin and NO arguments;
# the stdin-payload cases the PostToolUse version carried are gone with it.
#
# This hook never exits nonzero, so the harness asserts BOTH the exit code and
# whether the banner reached stdout — exit code alone cannot distinguish fire
# from silent here.
#
# Usage: .claude/hooks/claim-shape-guard.probe.sh   (from repo root)

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/claim-shape-guard.sh"

REPO=$(mktemp -d)
cleanup() { rm -rf "$REPO"; }
trap cleanup EXIT

git init -q -b main "$REPO" >/dev/null 2>&1 || {
    echo "FATAL: could not init throwaway repo" >&2
    exit 1
}
git -C "$REPO" config user.email probe@example.invalid
git -C "$REPO" config user.name 'Probe Harness'
git -C "$REPO" config commit.gpgsign false

# An initial commit gives `git reset` a HEAD to unstage against, so each
# fixture below is measured in isolation rather than accumulating.
printf 'seed\n' >"$REPO/seed.txt"
git -C "$REPO" add -A >/dev/null 2>&1
git -C "$REPO" commit -q --no-verify -m 'probe: seed' >/dev/null 2>&1

fail=0

# stage_fixture <relpath> <content>  — clear the index, then stage ONE file.
#
# The add is scoped to <relpath> rather than `-A` on purpose: `git reset`
# unstages but leaves every earlier fixture sitting untracked in the worktree,
# so an `-A` here would re-stage all of them and each case would inherit the
# previous ones' claim lines. (Observed: every case after the first fired.)
stage_fixture() {
    local relpath="$1" content="$2"
    git -C "$REPO" reset -q >/dev/null 2>&1
    mkdir -p "$REPO/$(dirname "$relpath")"
    printf '%s\n' "$content" >"$REPO/$relpath"
    git -C "$REPO" add -- "$relpath" >/dev/null 2>&1
}

check() { # $1=expected_exit  $2=fire|silent  $3=label
    local out got fired
    out=$(CLAUDE_PROJECT_DIR="$REPO" "$HOOK" 2>/dev/null)
    got=$?
    if grep -q 'CLAIM-SHAPE GUARD' <<<"$out"; then
        fired="fire"
    elif [ -z "${out//[[:space:]]/}" ]; then
        fired="silent"
    else
        fired="unexpected-output"
    fi
    if [ "$got" != "$1" ] || [ "$fired" != "$2" ]; then
        echo "FAIL [exit=$got want=$1 | $fired want=$2]: $3"
        fail=1
    else
        echo "ok   [exit=$got | $fired]: $3"
    fi
}

stage_fixture 'src/claim.ts' '// this field is always populated by the enqueue path'
check 0 fire "claim-shaped comment staged in a .ts file"

stage_fixture 'tracker/task-1.md' '// this field is always populated by the enqueue path'
check 0 silent "same claim line under tracker/ (excluded meta path)"

stage_fixture 'docs/reference/notes.md' 'The producer guarantees the id is never null here.'
check 0 silent "claim line under docs/ (excluded meta path)"

stage_fixture '.claude/rules/probe.md' 'A field that is always set needs a producer citation.'
check 0 silent "claim line under .claude/ (excluded meta path)"

# .husky/ scripts necessarily quote the phrasings this guard looks for, in the
# comments that describe it. Observed live: the guard flagged its own
# invocation comment in .husky/pre-commit on the commit that introduced it.
stage_fixture '.husky/pre-commit' '# scan for "always populated" / "never null" claims'
check 0 silent "claim phrasing in a .husky/ hook script (excluded meta path)"

stage_fixture 'CLAUDE.md' 'The pool max is guaranteed to apply at boot.'
check 0 silent "claim line in root CLAUDE.md (excluded meta file)"

stage_fixture 'services/voice-engine/CLAUDE.md' 'Responses are always present here.'
check 0 silent "claim line in a per-service CLAUDE.md (excluded meta file)"

stage_fixture 'CURRENT.md' 'The nightly sync is always gated on the hour window.'
check 0 silent "claim line in a root .md (markdown-wide exclusion)"

stage_fixture 'src/plain.ts' 'export const limit = 100;'
check 0 silent "staged change with no claim shapes"

stage_fixture 'src/never.ts' 'const id = row.id; // never undefined once the job is queued'
check 0 fire "never-<state> phrasing in a code file"

stage_fixture 'src/cannot.ts' 'return dedupe(rows); // a duplicate id cannot happen here'
check 0 fire "cannot-<verb> phrasing in a code file"

stage_fixture 'src/isalways.ts' 'seed(map); // the map is always seeded before first read'
check 0 fire "is-always phrasing in a code file"

stage_fixture 'src/onlyever.ts' 'const job = queue[0]; // this queue only ever holds one job'
check 0 fire "only-ever phrasing in a code file"

# Mixed staging: the excluded path must not suppress the code file beside it.
git -C "$REPO" reset -q >/dev/null 2>&1
mkdir -p "$REPO/docs" "$REPO/src"
printf '%s\n' 'Docs prose: the value is always present.' >"$REPO/docs/mixed.md"
printf '%s\n' 'const v = ctx.value; // guaranteed to exist after step 2' >"$REPO/src/mixed.ts"
git -C "$REPO" add -- docs/mixed.md src/mixed.ts >/dev/null 2>&1
check 0 fire "mixed staging: excluded doc beside a claim-shaped code file"

# An UNSTAGED claim must not fire — the guard reads the index, not the worktree.
git -C "$REPO" reset -q >/dev/null 2>&1
printf '%s\n' 'const x = 1; // this is always set before use' >"$REPO/src/unstaged.ts"
check 0 silent "claim-shaped line present in the worktree but not staged"

# Empty index (nothing staged at all).
git -C "$REPO" reset -q >/dev/null 2>&1
rm -f "$REPO/src/unstaged.ts"
check 0 silent "empty index"

[ "$fail" = 0 ] && echo "ALL PASS" || {
    echo "FAILURES"
    exit 1
}
