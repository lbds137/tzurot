#!/bin/bash
# Fixture check for bare-token-binding-reminder.sh — run after ANY edit to the
# hook. Asserts the fire/silent table over the shapes that matter: a whole-message
# approval / decline / selection token fires; the same token used as the OPENING
# of a real sentence stays silent, as do slash commands, multi-line messages, and
# anything past the 60-character ceiling.
#
# The hook takes its payload on stdin as the UserPromptSubmit JSON envelope, so
# each fixture is one `{"prompt": …}` object built with jq (the same tool the
# hook parses with — without it the hook is inert and no case here is meaningful,
# hence the FATAL rather than a skip).
#
# The hook never exits nonzero, so the harness asserts BOTH the exit code and
# whether the banner reached stdout — exit code alone cannot distinguish fire
# from silent here.
#
# Usage: .claude/hooks/bare-token-binding-reminder.probe.sh   (from repo root)

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/bare-token-binding-reminder.sh"

command -v jq >/dev/null 2>&1 || {
    echo "FATAL: jq is required — the hook parses its stdin envelope with it" >&2
    exit 1
}

fail=0

check() { # $1=fire|silent  $2=prompt  $3=label
    local out got fired json
    json=$(jq -nc --arg p "$2" '{prompt: $p}')
    out=$(printf '%s' "$json" | "$HOOK" 2>/dev/null)
    got=$?
    if grep -q 'BARE-TOKEN APPROVAL' <<<"$out"; then
        fired="fire"
    elif [ -z "${out//[[:space:]]/}" ]; then
        fired="silent"
    else
        fired="unexpected-output"
    fi
    if [ "$got" != 0 ] || [ "$fired" != "$1" ]; then
        echo "FAIL [exit=$got want=0 | $fired want=$1]: $3"
        fail=1
    else
        echo "ok   [exit=$got | $fired]: $3"
    fi
}

# --- MUST TRIGGER -----------------------------------------------------------

check fire 'sure' "single approval token"
check fire 'A' "bare option letter (uppercase — matching is case-insensitive)"
check fire 'okay' "approval token spelled out"
check fire 'yes and yes' "compound token chain"
check fire 'I approve your recommendation' "content-free recommendation approval"
check fire "let's go with your recommendations" "let's-go-with form (apostrophe)"
check fire 'approve both' "approve-both selector"
check fire 'yes please' "courtesy suffix: please"
check fire '1' "bare option digit"
check fire 'the second one' "ordinal option selector"
check fire 'sounds good' "multi-word approval token"
check fire 'Sounds good, thanks!' "punctuation + courtesy suffix + punctuation"
check fire 'no' "bare decline token"

# --- MUST NOT TRIGGER -------------------------------------------------------

# The whole point of the anchoring: every one of these OPENS with a token the
# fire table above matches, and then carries real content.
check silent 'sure we can work on 444' "token as the opening of a real sentence"
check silent 'yes and yes but hold the second until tomorrow' "chain followed by content"
check silent 'can you merge the PR?' "question containing an approval word"
check silent '/compact' "slash command"
check silent 'approved the design doc needs one tweak' "approval word opening a directive"

# 72 characters — over the ceiling. Belt-and-braces: it would not match anyway.
check silent 'yes let us proceed with the plan you outlined and then run the gates now' \
    "long sentence starting with yes (over the 60-char ceiling)"

# 67 characters, and it DOES full-match the compound-chain shape — so this is
# the case that actually pins the length guard rather than the pattern.
check silent 'yes and yes and yes and yes and yes and yes and yes and yes and yes' \
    "matching chain past the 60-char ceiling (pins the length guard)"

check silent $'yes\nand also please check the migration ordering' \
    "two-line message whose first line is a bare token"

check silent '' "empty prompt"

check silent "1. yes, 2. discretionary. it's only really a rule of thumb" \
    "enumerated answer opening with a digit selector"

[ "$fail" = 0 ] && echo "ALL PASS" || {
    echo "FAILURES"
    exit 1
}
