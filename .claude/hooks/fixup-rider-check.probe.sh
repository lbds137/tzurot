#!/bin/bash
# Fixture check for fixup-rider-check.sh — run after ANY edit to the hook.
# Asserts the fire/silent table: only a `git commit` carrying `--fixup` fires
# the rider checklist; plain commits, non-git Bash, other tools, and malformed
# stdin all stay silent.
#
# Like the empty-result-stderr-guard probe, this hook never exits nonzero, so
# the harness asserts BOTH the exit code and whether the banner reached stdout
# — exit code alone cannot distinguish fire from silent here.
#
# Colocated with the hook — it IS the hook's verification mechanism, a bash
# harness over a bash hook, run manually on hook edits.
#
# Usage: .claude/hooks/fixup-rider-check.probe.sh   (from repo root)

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/fixup-rider-check.sh"

fail=0
check() { # $1=expected_exit  $2=fire|silent  $3=label  $4=json
    local out got fired
    out=$(echo "$4" | "$HOOK" 2>/dev/null)
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

check 0 fire "fixup commit, --fixup=<sha> form" \
    '{"tool_name":"Bash","tool_input":{"command":"git commit --fixup=abc1234"}}'
check 0 fire "fixup commit, --fixup <sha> space form" \
    '{"tool_name":"Bash","tool_input":{"command":"git add -A && git commit --fixup abc1234"}}'
check 0 fire "fixup commit behind a git global flag" \
    '{"tool_name":"Bash","tool_input":{"command":"git -C /repo commit --fixup=abc1234"}}'
check 0 silent "plain commit with a message" \
    '{"tool_name":"Bash","tool_input":{"command":"git add -A && git commit -m \"fix: thing\""}}'
check 0 silent "amend commit (not a fixup)" \
    '{"tool_name":"Bash","tool_input":{"command":"git commit --amend --no-edit"}}'
check 0 silent "non-git Bash command" \
    '{"tool_name":"Bash","tool_input":{"command":"pnpm test"}}'
check 0 silent "--fixup token without a git commit (rebase autosquash)" \
    '{"tool_name":"Bash","tool_input":{"command":"echo --fixup is a commit flag"}}'
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
