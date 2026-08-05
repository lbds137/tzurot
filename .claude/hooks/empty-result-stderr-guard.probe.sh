#!/bin/bash
# Fixture check for empty-result-stderr-guard.sh — run after ANY edit to the hook.
# Asserts the fire/silent table over the shapes that matter: only an explicit
# `2>/dev/null` (with or without a space) paired with empty-or-whitespace stdout
# fires the reminder; `2>&1`, `&>/dev/null`, no-redirect, non-empty stdout,
# non-Bash tools, and malformed stdin all stay silent.
#
# Unlike the blocking guards' probes, this hook never exits nonzero — so the
# harness asserts BOTH the exit code and whether the banner reached stdout,
# since exit code alone cannot distinguish fire from silent here.
#
# Colocated with the hook — it IS the hook's verification mechanism, a bash
# harness over a bash hook, run manually on hook edits.
#
# Usage: .claude/hooks/empty-result-stderr-guard.probe.sh   (from repo root)

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/empty-result-stderr-guard.sh"
export CLAUDE_PROJECT_DIR=$(cd "$SCRIPT_DIR/../.." && pwd)

fail=0
check() { # $1=expected_exit  $2=fire|silent  $3=label  $4=json
    local out got fired
    out=$(echo "$4" | "$HOOK" 2>/dev/null)
    got=$?
    if grep -q 'EMPTY RESULT + SUPPRESSED STDERR' <<<"$out"; then
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

check 0 fire "2>/dev/null + empty stdout" \
    '{"tool_name":"Bash","tool_input":{"command":"gh api repos/x/y 2>/dev/null"},"tool_result":{"stdout":""}}'
check 0 fire "2>/dev/null + whitespace-only stdout" \
    '{"tool_name":"Bash","tool_input":{"command":"grep foo bar.txt 2>/dev/null"},"tool_result":{"stdout":"  \n\t\n"}}'
check 0 silent "2>/dev/null + non-empty stdout" \
    '{"tool_name":"Bash","tool_input":{"command":"grep foo bar.txt 2>/dev/null"},"tool_result":{"stdout":"bar.txt:foo\n"}}'
check 0 silent "no stderr redirect + empty stdout" \
    '{"tool_name":"Bash","tool_input":{"command":"grep foo bar.txt"},"tool_result":{"stdout":""}}'
check 0 silent "> /dev/null 2>&1 + empty stdout (exit-code-only shape)" \
    '{"tool_name":"Bash","tool_input":{"command":"gh pr checks 5 > /dev/null 2>&1"},"tool_result":{"stdout":""}}'
check 0 fire "space variant: 2> /dev/null + empty stdout" \
    '{"tool_name":"Bash","tool_input":{"command":"railway logs 2> /dev/null"},"tool_result":{"stdout":""}}'
check 0 silent "non-Bash tool" \
    '{"tool_name":"Read","tool_input":{"file_path":"x"},"tool_result":{"stdout":""}}'
check 0 silent "malformed stdin" \
    '{"tool_name":"Bash", not json'
check 0 silent "empty stdin" \
    ''

# Coverage for the documented exclusions and the alternate payload field paths.
check 0 silent "&>/dev/null + empty stdout (stdout discarded too)" \
    '{"tool_name":"Bash","tool_input":{"command":"which foo &>/dev/null"},"tool_result":{"stdout":""}}'
check 0 silent "bare 2>&1 merge + empty stdout" \
    '{"tool_name":"Bash","tool_input":{"command":"pnpm test 2>&1"},"tool_result":{"stdout":""}}'
check 0 silent "2>/dev/null + non-empty stdout via .tool_response.output fallback" \
    '{"tool_name":"Bash","tool_input":{"command":"ls x 2>/dev/null"},"tool_response":{"output":"a.ts\n"}}'
check 0 fire "2>/dev/null + no stdout field at all (extraction-miss false positive is accepted)" \
    '{"tool_name":"Bash","tool_input":{"command":"ls x 2>/dev/null"}}'

[ "$fail" = 0 ] && echo "ALL PASS" || {
    echo "FAILURES"
    exit 1
}
