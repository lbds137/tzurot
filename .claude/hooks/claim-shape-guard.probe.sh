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

# A NON-markdown fixture on purpose: a .md file here would be silenced by the
# markdown-wide exclusion regardless of whether the .claude/ path-prefix branch
# works at all, so the case would pass through a regression in that branch.
stage_fixture '.claude/hooks/probe-fixture.sh' '# a field that is always set needs a producer citation'
check 0 silent "claim line under .claude/ (excluded meta path, non-markdown)"

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

# `cannot be` is narrowed to a following VALUE token. Both directions are
# pinned, because the allow side is the whole point of the narrowing: bare
# `cannot be` fired on ordinary design prose about code structure, and a guard
# that mostly cries wolf trains the reader to skim past its true positives.
stage_fixture 'src/cannotnull.ts' 'assert(id); // the id cannot be null once queued'
check 0 fire "cannot-be with a value token is still a runtime claim"

stage_fixture 'src/cannotempty.ts' 'use(rows); // the batch cannot be empty here'
check 0 fire "cannot-be-empty is still a runtime claim"

# The exact line that false-fired in practice, on a comment about why two
# regex copies stay separate.
stage_fixture 'src/collapse.ts' '// They cannot be collapsed into one: each needs its own stripping'
check 0 silent "cannot-be-collapsed is design prose, not a runtime claim"

stage_fixture 'src/extract.ts' '// this helper cannot be extracted without three callbacks'
check 0 silent "cannot-be-extracted is design prose"

stage_fixture 'src/reuse.ts' '// the adapter cannot be reused across implementors'
check 0 silent "cannot-be-reused is design prose"

# One fixture per value token. The alternation is 13 branches wide and the
# probe is the only verification this hook gets, so a typo in any single branch
# must fail here rather than silently stop catching that claim shape.
stage_fixture 'src/tok0.ts' '// the value cannot be null at this point'
check 0 fire "value token: cannot be null"

stage_fixture 'src/tok1.ts' '// the value cannot be empty at this point'
check 0 fire "value token: cannot be empty"

stage_fixture 'src/tok2.ts' '// the value cannot be undefined at this point'
check 0 fire "value token: cannot be undefined"

stage_fixture 'src/tok3.ts' '// the value cannot be unset at this point'
check 0 fire "value token: cannot be unset"

stage_fixture 'src/tok4.ts' '// the value cannot be set at this point'
check 0 fire "value token: cannot be set"

stage_fixture 'src/tok5.ts' '// the value cannot be present at this point'
check 0 fire "value token: cannot be present"

stage_fixture 'src/tok6.ts' '// the value cannot be absent at this point'
check 0 fire "value token: cannot be absent"

stage_fixture 'src/tok7.ts' '// the value cannot be missing at this point'
check 0 fire "value token: cannot be missing"

stage_fixture 'src/tok8.ts' '// the value cannot be zero at this point'
check 0 fire "value token: cannot be zero"

stage_fixture 'src/tok9.ts' '// the value cannot be negative at this point'
check 0 fire "value token: cannot be negative"

stage_fixture 'src/tok10.ts' '// the value cannot be false at this point'
check 0 fire "value token: cannot be false"

stage_fixture 'src/tok11.ts' '// the value cannot be true at this point'
check 0 fire "value token: cannot be true"

stage_fixture 'src/tok12.ts' '// the value cannot be populated at this point'
check 0 fire "value token: cannot be populated"

# The `$` half of the boundary. Every fire fixture above has trailing text, so
# a typo shrinking ([^a-z]|$) to ([^a-z]) would pass all of them while silently
# dropping every claim that ENDS at the token — a completely ordinary shape for
# a short inline comment.
stage_fixture 'src/tokeol.ts' '// the id cannot be null'
check 0 fire "value token at end of line (the \$ half of the boundary)"

# The `reached` exclusion is a reasoned decision, so it gets a pin like every
# other one. Under the old bare arm this fired; it must now stay silent, and an
# accidental re-addition of the token to the list has to fail here.
stage_fixture 'src/reached.ts' '// this branch cannot be reached'
check 0 silent "reached is out of scope by design (control flow, not a value)"

# The accepted recall loss, pinned so it reads as chosen rather than missed: an
# inflected form no longer fires. If a future edit decides to catch these, this
# case is where that intent gets stated.
stage_fixture 'src/nulled.ts' '// the config cannot be nulled once persisted'
check 0 silent "inflected forms fall outside the narrowed pattern (accepted)"

# `unset` gets its own collision pin because English is unusually rich in words
# that start with it — "unsettled", "unsettling" — making it the token most
# likely to meet a real collision, alongside the five already pinned below.
stage_fixture 'src/unsettled.ts' '// this precedent cannot be unsettled by one case'
check 0 silent "collision: 'unsettled' must not match the 'unset' token"

# SUBSTRING COLLISIONS. awk's `~` is a substring match with no \b support,
# so an unanchored alternation fired on ordinary English whose next word
# merely STARTS with a value token — reintroducing the exact false-positive
# class this narrowing exists to remove. The trailing ([^a-z]|$) is what
# stops it, and these pin it per colliding token.
stage_fixture 'src/coll0.ts' '// this cannot be settled without more data'
check 0 silent "collision: 'settled' must not match the 'set' token"

stage_fixture 'src/coll1.ts' '// this cannot be negatively impacted'
check 0 silent "collision: 'negatively' must not match the 'negative' token"

stage_fixture 'src/coll2.ts' '// the count cannot be zeroed out'
check 0 silent "collision: 'zeroed' must not match the 'zero' token"

stage_fixture 'src/coll3.ts' '// this cannot be falsely triggered'
check 0 silent "collision: 'falsely' must not match the 'false' token"

stage_fixture 'src/coll4.ts' '// this cannot be presently disabled'
check 0 silent "collision: 'presently' must not match the 'present' token"

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
