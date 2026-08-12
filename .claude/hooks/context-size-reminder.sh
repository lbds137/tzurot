#!/bin/bash
# Context-size reminder (UserPromptSubmit).
#
# The owner carried the "should we compact?" monitoring ~10 times across four
# days (2026-08-09..12 mining, R2) and proposed a context-keyed reminder hook
# themselves — the assistant's "compact proactively at unit boundaries" rule
# demonstrably does not self-execute at long context. This hook is the
# mechanical trigger: when the LAST assistant turn began at or above the
# threshold, it injects a one-line reminder to name the next clean compaction
# boundary, throttled per session so it nags at most once per cooldown window.
#
# Mechanism: the harness hands UserPromptSubmit hooks the session transcript
# path; each assistant entry carries message.usage, whose input_tokens +
# cache_read_input_tokens + cache_creation_input_tokens is the context size
# that turn started from. Only the transcript TAIL is read — session files
# reach tens of MB and this runs on every user prompt.
#
# Fail-open everywhere: no jq, no transcript, unreadable tail, non-numeric
# total — silent exit 0. A reminder hook must never block a prompt.

set -uo pipefail

command -v jq >/dev/null 2>&1 || exit 0

INPUT=$(cat)

TRANSCRIPT=$(jq -r '.transcript_path // empty' <<<"$INPUT" 2>/dev/null || echo "")
SESSION=$(jq -r '.session_id // empty' <<<"$INPUT" 2>/dev/null || echo "")

[ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ] && [ -r "$TRANSCRIPT" ] || exit 0
[ -n "$SESSION" ] || exit 0

THRESHOLD_TOKENS=500000
COOLDOWN_MIN=30

# The session id reaches a filesystem path, so anything outside the safe set is
# folded to `_` rather than trusted (same set as queued-message-receipt.sh).
SAFE_SESSION=$(printf '%s' "$SESSION" | tr -c 'A-Za-z0-9._-' '_')

STATE_DIR="/tmp/claude-$(id -u)"
STAMP="$STATE_DIR/context-reminder-$SAFE_SESSION"

# Mode is set atomically at creation (-m), and a pre-existing directory is
# trusted only if this user owns it: the path is predictable, so on a shared
# /tmp another user could pre-create it (dir squat / symlink plant, CWE-377) —
# chmod on a dir we don't own would fail silently and the write would proceed
# into hostile territory. Fail open instead. (Verbatim from
# queued-message-receipt.sh, which hardened this exact directory first.)
mkdir -p -m 700 "$STATE_DIR" 2>/dev/null || exit 0
[ ! -L "$STATE_DIR" ] || exit 0
[ -O "$STATE_DIR" ] || exit 0
chmod 700 "$STATE_DIR" 2>/dev/null || true

# Throttle: if a reminder fired within the cooldown, stay silent. find prints
# the stamp only when it is OLDER than the cooldown, so empty output while the
# stamp exists means "recent" — skip.
if [ -f "$STAMP" ] && [ -z "$(find "$STAMP" -mmin +"$COOLDOWN_MIN" 2>/dev/null)" ]; then
    exit 0
fi

# Last assistant usage from the transcript tail. `jq -R 'fromjson?'` parses
# per line and silently drops anything malformed — the mid-line cut at the
# start of a >4MB tail AND a partial last line mid-write — without positional
# dropping, so a sub-4MB transcript whose first line is the relevant entry
# still counts (same pattern as queued-message-receipt.sh).
TOTAL=$(tail -c 4000000 "$TRANSCRIPT" 2>/dev/null \
    | jq -R -r 'fromjson? | select(.type? == "assistant") | .message.usage | select(. != null)
             | ((.input_tokens // 0) + (.cache_read_input_tokens // 0) + (.cache_creation_input_tokens // 0))' 2>/dev/null \
    | tail -1)

case "$TOTAL" in
    '' | *[!0-9]*) exit 0 ;;
esac

[ "$TOTAL" -ge "$THRESHOLD_TOKENS" ] || exit 0

touch "$STAMP" 2>/dev/null

KTOK=$((TOTAL / 1000))
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "CONTEXT SIZE: the last turn began at ~${KTOK}k tokens (threshold $((THRESHOLD_TOKENS / 1000))k)."
echo "Proactively name the next clean compaction boundary (unit close, PR"
echo "merge) in your reply instead of waiting for the user to ask — standing"
echo "owner request. This reminder throttles for ${COOLDOWN_MIN} minutes."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
