#!/bin/bash
# Fixture check for claim-shape-guard.sh — run after ANY edit to the hook.
# Asserts the fire/silent table over the shapes that matter: a claim-shaped
# line added to a code file fires; the same line under an excluded meta path
# (tracker/, backlog/, docs/, .claude/) stays silent; a commit with no claim
# shapes stays silent; non-commit commands and malformed stdin stay silent.
#
# The hook reads real git state (`git show HEAD`), so the fixtures are commits
# in a THROWAWAY repo under $(mktemp -d) pointed at by CLAUDE_PROJECT_DIR —
# the probe never touches this repo's HEAD.
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

COMMIT_JSON='{"tool_name":"Bash","tool_input":{"command":"git add -A && git commit -m \"probe\""}}'

fail=0

# commit_fixture <relpath> <content>  — one file, one commit, in the fixture repo.
commit_fixture() {
    local relpath="$1" content="$2"
    mkdir -p "$REPO/$(dirname "$relpath")"
    printf '%s\n' "$content" >"$REPO/$relpath"
    git -C "$REPO" add -A >/dev/null 2>&1
    git -C "$REPO" commit -q --no-verify -m "probe: $relpath" >/dev/null 2>&1
}

check() { # $1=expected_exit  $2=fire|silent  $3=label  $4=json
    local out got fired
    out=$(echo "$4" | CLAUDE_PROJECT_DIR="$REPO" "$HOOK" 2>/dev/null)
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

commit_fixture 'src/claim.ts' '// this field is always populated by the enqueue path'
check 0 fire "claim-shaped comment added to a .ts file" "$COMMIT_JSON"

commit_fixture 'tracker/task-1.md' '// this field is always populated by the enqueue path'
check 0 silent "same claim line under tracker/ (excluded meta path)" "$COMMIT_JSON"

commit_fixture 'docs/reference/notes.md' 'The producer guarantees the id is never null here.'
check 0 silent "claim line under docs/ (excluded meta path)" "$COMMIT_JSON"

commit_fixture '.claude/rules/probe.md' 'A field that is always set needs a producer citation.'
check 0 silent "claim line under .claude/ (excluded meta path)" "$COMMIT_JSON"

commit_fixture 'CLAUDE.md' 'The pool max is guaranteed to apply at boot.'
check 0 silent "claim line in root CLAUDE.md (excluded meta file)" "$COMMIT_JSON"

commit_fixture 'services/voice-engine/CLAUDE.md' 'Responses are always present here.'
check 0 silent "claim line in a per-service CLAUDE.md (excluded meta file)" "$COMMIT_JSON"

commit_fixture 'CURRENT.md' 'The nightly sync is always gated on the hour window.'
check 0 silent "claim line in a root .md (markdown-wide exclusion)" "$COMMIT_JSON"

commit_fixture 'src/plain.ts' 'export const limit = 100;'
check 0 silent "commit with no claim shapes" "$COMMIT_JSON"

commit_fixture 'src/never.ts' 'const id = row.id; // never undefined once the job is queued'
check 0 fire "never-<state> phrasing in a code file" "$COMMIT_JSON"

commit_fixture 'src/cannot.ts' 'return dedupe(rows); // a duplicate id cannot happen here'
check 0 fire "cannot-<verb> phrasing in a code file" "$COMMIT_JSON"

commit_fixture 'src/isalways.ts' 'seed(map); // the map is always seeded before first read'
check 0 fire "is-always phrasing in a code file" "$COMMIT_JSON"

commit_fixture 'src/onlyever.ts' 'const job = queue[0]; // this queue only ever holds one job'
check 0 fire "only-ever phrasing in a code file" "$COMMIT_JSON"

# Mixed commit: the excluded path must not suppress the code file beside it.
mkdir -p "$REPO/docs" "$REPO/src"
printf '%s\n' 'Docs prose: the value is always present.' >"$REPO/docs/mixed.md"
printf '%s\n' 'const v = ctx.value; // guaranteed to exist after step 2' >"$REPO/src/mixed.ts"
git -C "$REPO" add -A >/dev/null 2>&1
git -C "$REPO" commit -q --no-verify -m 'probe: mixed' >/dev/null 2>&1
check 0 fire "mixed commit: excluded doc beside a claim-shaped code file" "$COMMIT_JSON"

# HEAD still carries a claim shape for these — only the COMMAND differs.
check 0 silent "non-commit Bash command" \
    '{"tool_name":"Bash","tool_input":{"command":"pnpm test"}}'
check 0 silent "git command that is not a commit" \
    '{"tool_name":"Bash","tool_input":{"command":"git log --oneline -5"}}'
check 0 silent "plumbing subcommand is not a commit (commit-tree)" \
    '{"tool_name":"Bash","tool_input":{"command":"git commit-tree abc1234 -m x"}}'
check 0 fire "fixup commit form (any commit variant scans HEAD)" \
    '{"tool_name":"Bash","tool_input":{"command":"git commit --fixup=abc1234"}}'
check 0 silent "non-Bash tool" \
    '{"tool_name":"Read","tool_input":{"file_path":"x"}}'
check 0 silent "malformed stdin" \
    '{"tool_name":"Bash", not json'
check 0 silent "empty stdin" \
    ''

[ "$fail" = 0 ] && echo "ALL PASS" || {
    echo "FAILURES"
    exit 1
}
