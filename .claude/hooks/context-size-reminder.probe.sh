#!/bin/bash
# Fixture check for context-size-reminder.sh — run after ANY edit to the hook.
#
# The hook decides from two inputs: the last assistant entry's usage total in
# the transcript tail, and a per-session throttle stamp. Each case builds a
# fixture transcript, invokes the hook with a crafted UserPromptSubmit
# envelope, and asserts fire/silent — plus the stamp where it is the subject.
#
# Threshold boundary cases pin 499_999 (silent) vs 500_001 (fires) so a drift
# in the constant or the summation reddens a specific assertion, not a vague
# one. Session ids are unique per case; stamps and fixtures are removed on
# exit.
#
# Usage: .claude/hooks/context-size-reminder.probe.sh   (from repo root)

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/context-size-reminder.sh"

command -v jq >/dev/null 2>&1 || {
    echo "FATAL: jq is required — the hook parses its stdin envelope with it" >&2
    exit 1
}

TMPDIR_PROBE=$(mktemp -d)
STATE_DIR="/tmp/claude-$(id -u)"
SESSION_PREFIX="probe-ctx-$$"

cleanup() {
    rm -rf "$TMPDIR_PROBE"
    rm -f "$STATE_DIR/context-reminder-$SESSION_PREFIX"-* 2>/dev/null
}
trap cleanup EXIT

fail=0
OUT=""
RC=0

stamp_file() { # $1 = session suffix
    printf '%s/context-reminder-%s-%s' "$STATE_DIR" "$SESSION_PREFIX" "$1"
}

# One assistant transcript line whose usage sums to the given parts.
# $1 input_tokens, $2 cache_read, $3 cache_creation
assistant_line() {
    jq -nc --argjson i "$1" --argjson r "$2" --argjson c "$3" \
        '{type: "assistant", message: {usage: {input_tokens: $i, cache_read_input_tokens: $r, cache_creation_input_tokens: $c, output_tokens: 100}}}'
}

user_line() {
    jq -nc '{type: "user", message: {content: "hello"}}'
}

# Run the hook. $1 = session suffix, $2 = transcript path ("" omits the field).
run_hook() {
    local session="$SESSION_PREFIX-$1" json
    if [ -z "$2" ]; then
        json=$(jq -nc --arg s "$session" '{prompt: "next", session_id: $s}')
    else
        json=$(jq -nc --arg s "$session" --arg t "$2" \
            '{prompt: "next", session_id: $s, transcript_path: $t}')
    fi
    OUT=$(printf '%s' "$json" | "$HOOK" 2>/dev/null)
    RC=$?
}

assert_silent() { # $1 = label
    if [ "$RC" != 0 ] || [ -n "${OUT//[[:space:]]/}" ]; then
        echo "FAIL [exit=$RC want=0 | output=$([ -n "${OUT//[[:space:]]/}" ] && echo present || echo empty) want=empty]: $1"
        [ -n "$OUT" ] && printf '     got: %s\n' "$OUT"
        fail=1
    else
        echo "ok: $1"
    fi
}

assert_fires() { # $1 = label, $2 = required substring
    if [ "$RC" != 0 ] || [[ "$OUT" != *"CONTEXT SIZE"* ]] || [[ "$OUT" != *"$2"* ]]; then
        echo "FAIL [exit=$RC want=0 | banner=$([[ "$OUT" == *"CONTEXT SIZE"* ]] && echo yes || echo no) | substr($2)=$([[ "$OUT" == *"$2"* ]] && echo yes || echo no)]: $1"
        [ -n "$OUT" ] && printf '     got: %s\n' "$OUT"
        fail=1
    else
        echo "ok: $1"
    fi
}

# ---- Case 1: below threshold (499,999 total) → silent -----------------------
T="$TMPDIR_PROBE/below.jsonl"
{
    user_line
    assistant_line 99999 300000 100000 # sums to 499,999
} >"$T"
run_hook below "$T"
assert_silent "499,999 total stays silent (boundary, below)"

# ---- Case 2: above threshold (500,001) → fires with the ~k figure ----------
T="$TMPDIR_PROBE/above.jsonl"
{
    user_line
    assistant_line 1 400000 100000 # sums to 500,001
} >"$T"
run_hook above "$T"
assert_fires "500,001 total fires" "~500k tokens"
[ -f "$(stamp_file above)" ] && echo "ok: firing created the throttle stamp" || {
    echo "FAIL: no throttle stamp after firing"
    fail=1
}

# ---- Case 3: immediate re-run same session → throttled silent ---------------
run_hook above "$T"
assert_silent "second run inside the cooldown is throttled"

# ---- Case 4: stamp older than the cooldown → fires again --------------------
touch -d '45 minutes ago' "$(stamp_file above)" 2>/dev/null ||
    touch -t "$(date -d '45 minutes ago' +%Y%m%d%H%M 2>/dev/null || echo 197001010000)" "$(stamp_file above)"
run_hook above "$T"
assert_fires "aged stamp fires again" "~500k tokens"

# ---- Case 5: missing transcript_path → silent -------------------------------
run_hook nopath ""
assert_silent "missing transcript_path exits silently"

# ---- Case 6: LAST assistant entry rules, not an earlier one -----------------
# Earlier turn above threshold, last turn below (post-compaction shape).
T="$TMPDIR_PROBE/postcompact.jsonl"
{
    assistant_line 1 600000 0
    user_line
    assistant_line 1 50000 0
} >"$T"
run_hook postcompact "$T"
assert_silent "post-compaction (last assistant small) stays silent"

# ---- Case 7: partial trailing line still uses the last complete entry -------
T="$TMPDIR_PROBE/partial.jsonl"
{
    user_line
    assistant_line 1 500000 0
    printf '{"type":"assistant","message":{"usa' # mid-write cut, no newline
} >"$T"
run_hook partial "$T"
assert_fires "partial trailing line falls back to the last complete entry" "~500k tokens"

# ---- Case 8: no assistant entries at all → silent ---------------------------
T="$TMPDIR_PROBE/none.jsonl"
{
    user_line
    user_line
} >"$T"
run_hook none "$T"
assert_silent "transcript with no assistant usage stays silent"

# ---- Case 9: sub-4MB file whose FIRST line is the relevant entry still fires
# (guards against positional first-line dropping: tail -c on a short file
# starts at byte 0, a genuine line boundary — nothing may be discarded).
T="$TMPDIR_PROBE/firstline.jsonl"
{
    assistant_line 1 500000 0
} >"$T"
run_hook firstline "$T"
assert_fires "short file with the entry on line 1 fires" "~500k tokens"

# ---- Case 10: traversal-shaped session id stays inside STATE_DIR ------------
T="$TMPDIR_PROBE/traverse.jsonl"
{
    user_line
    assistant_line 1 500000 0
} >"$T"
json=$(jq -nc --arg s "../../$SESSION_PREFIX-evil" --arg t "$T" \
    '{prompt: "next", session_id: $s, transcript_path: $t}')
OUT=$(printf '%s' "$json" | "$HOOK" 2>/dev/null)
RC=$?
if [ -e "$STATE_DIR/../../$SESSION_PREFIX-evil" ] || [ -e "/tmp/context-reminder-$SESSION_PREFIX-evil" ]; then
    echo "FAIL: traversal session id escaped STATE_DIR"
    fail=1
else
    echo "ok: traversal-shaped session id stays inside STATE_DIR"
fi
rm -f "$STATE_DIR/context-reminder-.._.._$SESSION_PREFIX-evil" 2>/dev/null

exit $fail
