#!/bin/bash
# Fixture check for queued-message-receipt.sh — run after ANY edit to the hook.
#
# The hook decides from two inputs: a transcript JSONL tail and a per-session
# state file holding the highest enqueue timestamp already reported. So each
# case here builds a fixture transcript, points a crafted UserPromptSubmit
# envelope at it, and asserts BOTH the banner (fire/silent) and — where it is
# the actual subject — the state file's contents afterwards.
#
# Session ids are unique per case so the state files cannot collide; they are
# removed on exit along with the fixture directory.
#
# The hook never exits nonzero, so exit code alone cannot distinguish fire from
# silent — every assertion checks stdout too.
#
# Usage: .claude/hooks/queued-message-receipt.probe.sh   (from repo root)

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/queued-message-receipt.sh"

command -v jq >/dev/null 2>&1 || {
    echo "FATAL: jq is required — the hook parses its stdin envelope with it" >&2
    exit 1
}

TMPDIR_PROBE=$(mktemp -d)
STATE_DIR="/tmp/claude-$(id -u)"
SESSION_PREFIX="probe-queued-$$"

cleanup() {
    rm -rf "$TMPDIR_PROBE"
    rm -f "$STATE_DIR/queued-receipt-state-$SESSION_PREFIX"-* 2>/dev/null
    rm -f "$STATE_DIR/queued-receipt-state-.._.._$SESSION_PREFIX-traversal" 2>/dev/null
}
trap cleanup EXIT

fail=0
OUT=""
RC=0

state_file() { # $1 = session suffix
    printf '%s/queued-receipt-state-%s-%s' "$STATE_DIR" "$SESSION_PREFIX" "$1"
}

# One transcript line for an enqueue. $1 = timestamp, $2 = content.
enqueue_line() {
    jq -nc --arg ts "$1" --arg c "$2" \
        '{type: "queue-operation", operation: "enqueue", timestamp: $ts, content: $c}'
}

# A queue-operation that is NOT an enqueue.
dequeue_line() {
    jq -nc --arg ts "$1" '{type: "queue-operation", operation: "dequeue", timestamp: $ts}'
}

# Run the hook. $1 = session suffix, $2 = transcript path ("" omits the field),
# $3 = the stdin prompt (defaults to something no fixture's content matches —
# the hook excludes any enqueue equal to the current prompt, so a case that
# wants that exclusion passes $3 explicitly).
run_hook() {
    local session="$SESSION_PREFIX-$1" json prompt="${3:-next message}"
    if [ -z "$2" ]; then
        json=$(jq -nc --arg s "$session" --arg p "$prompt" \
            '{prompt: $p, session_id: $s}')
    else
        json=$(jq -nc --arg s "$session" --arg t "$2" --arg p "$prompt" \
            '{prompt: $p, session_id: $s, transcript_path: $t}')
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
        echo "ok   [exit=$RC | silent]: $1"
    fi
}

assert_fires() { # $1 = label, rest = substrings that must appear
    local label="$1"
    shift
    local missing=""
    if ! grep -q 'MID-TURN MESSAGES' <<<"$OUT"; then
        missing="banner"
    fi
    local needle
    for needle in "$@"; do
        grep -qF -- "$needle" <<<"$OUT" || missing="$missing [$needle]"
    done
    if [ "$RC" != 0 ] || [ -n "$missing" ]; then
        echo "FAIL [exit=$RC want=0 | missing:$missing]: $label"
        printf '     got: %s\n' "$OUT"
        fail=1
    else
        echo "ok   [exit=$RC | fired]: $label"
    fi
}

assert_absent() { # $1 = label, $2 = substring that must NOT appear
    if grep -qF -- "$2" <<<"$OUT"; then
        echo "FAIL [unexpected substring '$2']: $1"
        printf '     got: %s\n' "$OUT"
        fail=1
    else
        echo "ok   [absent '$2']: $1"
    fi
}

assert_state() { # $1 = label, $2 = session suffix, $3 = expected contents
    local path got
    path=$(state_file "$2")
    if [ ! -f "$path" ]; then
        echo "FAIL [state file missing: $path]: $1"
        fail=1
        return
    fi
    got=$(head -n 1 "$path")
    if [ "$got" != "$3" ]; then
        echo "FAIL [state='$got' want='$3']: $1"
        fail=1
    else
        echo "ok   [state=$got]: $1"
    fi
}

OLD_TS='2026-01-01T00:00:00.000Z'

# --- 1. Fresh session baselines silently -----------------------------------

T1="$TMPDIR_PROBE/case1.jsonl"
{
    enqueue_line '2026-08-01T10:00:00.000Z' 'first queued message'
    enqueue_line '2026-08-01T11:00:00.000Z' 'second queued message'
} >"$T1"

run_hook 1 "$T1"
assert_silent "fresh session with 2 enqueues stays silent (baseline run)"
assert_state "baseline run records the max enqueue timestamp" 1 '2026-08-01T11:00:00.000Z'

# --- 2. Same session, transcript unchanged ----------------------------------

run_hook 1 "$T1"
assert_silent "unchanged transcript on a baselined session stays silent"

# --- 3. Same session, a NEWER enqueue arrives -------------------------------

enqueue_line '2026-08-01T12:00:00.000Z' 'can you answer the webhook question first' >>"$T1"

run_hook 1 "$T1"
assert_fires "newer enqueue fires the banner" \
    'MID-TURN MESSAGES: 1' \
    'can you answer the webhook question first'
assert_state "state advances to the new max timestamp" 1 '2026-08-01T12:00:00.000Z'

# --- 4. Five new enqueues → 3 excerpts + "and 2 more" -----------------------

T4="$TMPDIR_PROBE/case4.jsonl"
{
    enqueue_line '2026-08-02T10:00:00.000Z' 'message one'
    enqueue_line '2026-08-02T10:00:01.000Z' 'message two'
    enqueue_line '2026-08-02T10:00:02.000Z' 'message three'
    enqueue_line '2026-08-02T10:00:03.000Z' 'message four'
    enqueue_line '2026-08-02T10:00:04.000Z' 'message five'
} >"$T4"
printf '%s\n' "$OLD_TS" >"$(state_file 4)"

run_hook 4 "$T4"
assert_fires "five new enqueues: count, first three excerpts, overflow line" \
    'MID-TURN MESSAGES: 5' \
    'message one' 'message two' 'message three' \
    '…and 2 more'
assert_absent "the fourth message is not excerpted" 'message four'

# --- 5. Transcript with no queue-operations ---------------------------------

T5="$TMPDIR_PROBE/case5.jsonl"
{
    jq -nc '{type: "user", message: {role: "user", content: "hello"}}'
    jq -nc '{type: "assistant", message: {role: "assistant", content: "hi"}}'
} >"$T5"
printf '%s\n' "$OLD_TS" >"$(state_file 5)"

run_hook 5 "$T5"
assert_silent "transcript with no queue-operations stays silent"
assert_state "state is left untouched when there is nothing to report" 5 "$OLD_TS"

# --- 6/7. Missing and nonexistent transcript --------------------------------

run_hook 6 ""
assert_silent "missing transcript_path exits silently"

run_hook 7 "$TMPDIR_PROBE/does-not-exist.jsonl"
assert_silent "nonexistent transcript path exits silently"

# --- 8. Truncated first line (the `tail -c` byte cut) -----------------------

T8="$TMPDIR_PROBE/case8.jsonl"
{
    printf '%s\n' 'ration":"enqueue","timestamp":"2026-08-03T09:00:00.000Z","content":"half a line"}'
    enqueue_line '2026-08-03T10:00:00.000Z' 'survived the byte cut'
    enqueue_line '2026-08-03T10:00:01.000Z' 'and so did this one'
} >"$T8"
printf '%s\n' "$OLD_TS" >"$(state_file 8)"

run_hook 8 "$T8"
assert_fires "truncated leading line is skipped, valid enqueues still counted" \
    'MID-TURN MESSAGES: 2' \
    'survived the byte cut' 'and so did this one'

# --- 9. Content longer than 80 characters -----------------------------------

LONG='0123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789 TAIL_MARKER'
T9="$TMPDIR_PROBE/case9.jsonl"
enqueue_line '2026-08-04T10:00:00.000Z' "$LONG" >"$T9"
printf '%s\n' "$OLD_TS" >"$(state_file 9)"

run_hook 9 "$T9"
assert_fires "over-long content is excerpted with an ellipsis" \
    'MID-TURN MESSAGES: 1' \
    '01234567890123456789012345678901234567890123456789012345678901234567890123456789…'
assert_absent "the excerpt drops everything past the 80-char ceiling" 'TAIL_MARKER'

# --- 10. queue-operation with operation != enqueue --------------------------

T10="$TMPDIR_PROBE/case10.jsonl"
{
    dequeue_line '2026-08-05T10:00:00.000Z'
    dequeue_line '2026-08-05T10:00:01.000Z'
} >"$T10"
printf '%s\n' "$OLD_TS" >"$(state_file 10)"

run_hook 10 "$T10"
assert_silent "dequeue operations are ignored"

# --- 11. Monitor task-notifications are not user messages -------------------
#
# The dominant real-world shape: 57 of 62 enqueues in a measured window were
# `<task-notification>` blocks. They carry a string .content like a user
# message does, so only the prefix separates them.

T11="$TMPDIR_PROBE/case11.jsonl"
{
    enqueue_line '2026-08-06T10:00:00.000Z' '<task-notification>
<task-id>abc123</task-id>
<summary>Monitor event: CI checks on PR #1892</summary>
</task-notification>'
    enqueue_line '2026-08-06T10:00:01.000Z' '<task-notification>
<task-id>def456</task-id>
</task-notification>'
    enqueue_line '2026-08-06T10:00:02.000Z' 'REAL_USER_ASK did you see my earlier question'
    enqueue_line '2026-08-06T10:00:03.000Z' '<task-notification>
<task-id>ghi789</task-id>
</task-notification>'
} >"$T11"
printf '%s\n' "$OLD_TS" >"$(state_file 11)"

run_hook 11 "$T11"
assert_fires "three task-notifications + one real message: only the real one counts" \
    'MID-TURN MESSAGES: 1' \
    'REAL_USER_ASK did you see my earlier question'
assert_absent "no task-notification markup reaches the banner" 'task-notification'
assert_absent "no Monitor task id reaches the banner" 'abc123'
assert_state "skipped task-notifications still advance the state" 11 '2026-08-06T10:00:03.000Z'

# --- 12. Slash commands need no receipt -------------------------------------

T12="$TMPDIR_PROBE/case12.jsonl"
{
    enqueue_line '2026-08-07T10:00:00.000Z' '/compact'
    enqueue_line '2026-08-07T10:00:01.000Z' 'SLASH_SIBLING a genuine ask'
} >"$T12"
printf '%s\n' "$OLD_TS" >"$(state_file 12)"

run_hook 12 "$T12"
assert_fires "a slash command alongside a real message: only the real one counts" \
    'MID-TURN MESSAGES: 1' \
    'SLASH_SIBLING a genuine ask'
assert_absent "the slash command is not excerpted" '/compact'

# --- 13. The message being submitted right now ------------------------------
#
# An ordinary, non-mid-turn message is ALSO written as an enqueue, so whenever
# that write lands before the hook runs the current message would otherwise
# report itself. It is excluded by content — but it must still advance the
# state, or it would be re-evaluated on every subsequent message forever.

CURRENT='this is the message I am submitting right now'
T13="$TMPDIR_PROBE/case13.jsonl"
enqueue_line '2026-08-08T10:00:00.000Z' "$CURRENT" >"$T13"
printf '%s\n' "$OLD_TS" >"$(state_file 13)"

run_hook 13 "$T13" "$CURRENT"
assert_silent "an enqueue equal to the current prompt does not report itself"
assert_state "the current message still advances the state" 13 '2026-08-08T10:00:00.000Z'

# The same content with surrounding whitespace on ONE side only — both sides are
# trimmed by the same expression, so it must still match.
T13B="$TMPDIR_PROBE/case13b.jsonl"
enqueue_line '2026-08-08T11:00:00.000Z' "  $CURRENT  " >"$T13B"
printf '%s\n' "$OLD_TS" >"$(state_file 14)"

run_hook 14 "$T13B" "$CURRENT"
assert_silent "prompt matching is whitespace-insensitive on both sides"

# --- 15. Path-traversal-shaped session id is sanitized ----------------------
#
# The session id reaches a filesystem path; anything outside [A-Za-z0-9._-]
# folds to `_`, so a traversal-shaped id lands as a plain filename INSIDE
# STATE_DIR rather than escaping it. Pins the sanitization as a tested
# property instead of a correct-by-inspection one.

T15="$TMPDIR_PROBE/case15.jsonl"
enqueue_line '2026-08-09T10:00:00.000Z' 'traversal fixture message' >"$T15"

EVIL_SESSION="../../$SESSION_PREFIX-traversal"
SAFE_NAME="queued-receipt-state-.._.._$SESSION_PREFIX-traversal"
json=$(jq -nc --arg s "$EVIL_SESSION" --arg t "$T15" --arg p 'next message' \
    '{prompt: $p, session_id: $s, transcript_path: $t}')
OUT=$(printf '%s' "$json" | "$HOOK" 2>/dev/null)
RC=$?
assert_silent "a traversal-shaped session id baselines silently"
if [ -f "$STATE_DIR/$SAFE_NAME" ]; then
    echo "ok   [state at sanitized path]: traversal id folds to a filename inside STATE_DIR"
else
    echo "FAIL [no state file at $STATE_DIR/$SAFE_NAME]: traversal id escaped or was dropped"
    fail=1
fi

# --- 16. A VERBATIM captured production transcript line parses ---------------
#
# Every other fixture is synthetic JSON this probe authored itself, so a real
# schema drift (a renamed field, a shape change) would sail past them. This
# line was captured verbatim from a live session transcript (harness-generated
# task-notification content — no user text). It pins the REAL field set
# (sessionId alongside the fields the hook reads); if the harness changes the
# enqueue shape, this case is the one that goes red. Live-verified 2026-08-09:
# 1,991 of 1,991 enqueue lines in the capture session carried string content.

T16="$TMPDIR_PROBE/case16.jsonl"
cat >"$T16" <<'REALLINE'
{"type":"queue-operation","operation":"enqueue","timestamp":"2026-08-01T17:44:16.516Z","sessionId":"3f50da50-2ed0-4de4-9829-b38a45f944f3","content":"<task-notification>\n<task-id>btdowilck</task-id>\n<summary>Monitor event: \"CI checks on PR #1892 (code-span discriminator family)\"</summary>"}
REALLINE
printf '%s\n' "$OLD_TS" >"$(state_file 16)"

run_hook 16 "$T16"
assert_silent "a verbatim real transcript enqueue parses and classifies (task-notification → skip)"
assert_state "the real line's timestamp advances the state (schema fields all read)" 16 '2026-08-01T17:44:16.516Z'

[ "$fail" = 0 ] && echo "ALL PASS" || {
    echo "FAILURES"
    exit 1
}
