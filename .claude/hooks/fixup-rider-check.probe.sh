#!/bin/bash
# Fixture check for fixup-rider-check.sh — run after ANY edit to the hook.
# Asserts the fire/silent table: a commit message whose SUBJECT carries git's
# `fixup!` / `squash!` / `amend!` prefix fires the rider checklist; an ordinary
# message stays silent; a missing or empty message file stays silent.
#
# The hook runs from .husky/commit-msg and takes the commit-message FILE as $1
# (git's commit-msg contract) — it reads no stdin. The stdin-payload cases the
# PostToolUse version carried are gone with it, and so is that version's
# documented false positive: a message that merely MENTIONS `--fixup` is now
# correctly silent, because the subject prefix is what git actually writes.
#
# This hook never exits nonzero, so the harness asserts BOTH the exit code and
# whether the banner reached stdout — exit code alone cannot distinguish fire
# from silent here.
#
# Usage: .claude/hooks/fixup-rider-check.probe.sh   (from repo root)

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/fixup-rider-check.sh"

TMP=$(mktemp -d)
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

fail=0
check() { # $1=expected_exit  $2=fire|silent  $3=label  $4=message-body
    local out got fired msgfile
    msgfile="$TMP/COMMIT_EDITMSG"
    printf '%s\n' "$4" >"$msgfile"
    out=$("$HOOK" "$msgfile" 2>/dev/null)
    got=$?
    if grep -q 'FIXUP RIDER CHECK' <<<"$out"; then
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

check 0 fire "fixup! subject (what git writes for --fixup)" \
    'fixup! feat(bot-client): add browse pagination'
check 0 fire "squash! subject (--squash)" \
    'squash! fix(api-gateway): tighten the guard'
check 0 fire "amend! subject (--fixup=amend:)" \
    'amend! docs: correct the release note'
check 0 silent "ordinary conventional-commit subject" \
    'feat(ai-worker): add pgvector memory retrieval'
check 0 silent "subject that MENTIONS --fixup but is not one (old false positive)" \
    'docs(tooling): explain when to use git commit --fixup'
check 0 silent "revert subject" \
    'revert: feat(bot-client): add browse pagination'

# Leading blanks and git comment lines must be skipped to find the subject.
printf '%s\n' '' '# Please enter the commit message for your changes.' \
    'fixup! chore: bump version' >"$TMP/COMMIT_EDITMSG_LEADING"
out=$("$HOOK" "$TMP/COMMIT_EDITMSG_LEADING" 2>/dev/null)
if grep -q 'FIXUP RIDER CHECK' <<<"$out"; then
    echo "ok   [exit=0 | fire]: subject found past leading blank + comment lines"
else
    echo "FAIL: subject not found past leading blank + comment lines"
    fail=1
fi

# A comment line that itself mentions fixup must not be mistaken for the subject.
printf '%s\n' '# fixup! this is git help text, not the subject' \
    'chore: routine change' >"$TMP/COMMIT_EDITMSG_COMMENT"
out=$("$HOOK" "$TMP/COMMIT_EDITMSG_COMMENT" 2>/dev/null)
if [ -z "${out//[[:space:]]/}" ]; then
    echo "ok   [exit=0 | silent]: comment line mentioning fixup is not the subject"
else
    echo "FAIL: comment line mentioning fixup was treated as the subject"
    fail=1
fi

# Degenerate inputs: no argument, missing file, empty file — all silent, exit 0.
out=$("$HOOK" 2>/dev/null)
got=$?
if [ "$got" = 0 ] && [ -z "${out//[[:space:]]/}" ]; then
    echo "ok   [exit=0 | silent]: no argument"
else
    echo "FAIL [exit=$got]: no argument should be silent+0"
    fail=1
fi

out=$("$HOOK" "$TMP/does-not-exist" 2>/dev/null)
got=$?
if [ "$got" = 0 ] && [ -z "${out//[[:space:]]/}" ]; then
    echo "ok   [exit=0 | silent]: missing message file"
else
    echo "FAIL [exit=$got]: missing message file should be silent+0"
    fail=1
fi

: >"$TMP/EMPTY"
out=$("$HOOK" "$TMP/EMPTY" 2>/dev/null)
got=$?
if [ "$got" = 0 ] && [ -z "${out//[[:space:]]/}" ]; then
    echo "ok   [exit=0 | silent]: empty message file"
else
    echo "FAIL [exit=$got]: empty message file should be silent+0"
    fail=1
fi

[ "$fail" = 0 ] && echo "ALL PASS" || {
    echo "FAILURES"
    exit 1
}
