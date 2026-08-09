#!/bin/bash
# Mid-turn message receipt reminder (UserPromptSubmit).
#
# Fires when the user typed one or more messages WHILE the assistant's previous
# turn was still in flight. 09-interaction-style.md § "Answer the User's
# Questions First" checkpoint (a) requires a one-line receipt at the top of the
# next reply for exactly those messages — the rule alone kept being violated
# under monitor-notification interleave, so this is its mechanical trigger.
#
# Detection is via the session TRANSCRIPT, because the hook's stdin envelope
# carries no origin flag: a mid-turn arrival is written to the transcript JSONL
# as a line with `"type":"queue-operation"` and `"operation":"enqueue"`, each
# carrying `.timestamp` (ISO8601, Z) and a string `.content`.
#
# State: one file per session holding the highest enqueue timestamp already
# reported. The FIRST run of a session only baselines that file and stays
# silent, so pre-existing history never spams. The transcript is written
# ASYNCHRONOUSLY and may lag the hook, which is why catch-up is the design: an
# enqueue that had not been flushed at this firing is simply picked up at the
# next one. Do NOT add sleeps or retries here — the state file is what makes
# lag harmless.
#
# Fail-open everywhere (exit 0, no output): no jq, no/unreadable transcript, no
# session id. A missed reminder is a missed reminder; a hook that errors on a
# UserPromptSubmit is in the way of every message.

set -uo pipefail

# Bash 4.4+ required: `mapfile` is a 4.0 builtin, but the empty-array `set -u`
# quirk (`"${arr[@]}"` on an empty array reads as unbound) was only FIXED in
# 4.4 — on 4.0-4.3 (RHEL 7 ships 4.2) an empty scan window would error on
# every prompt, and macOS stock bash is 3.2. Older bash fails open instead.
[ "${BASH_VERSINFO[0]:-0}" -gt 4 ] ||
    { [ "${BASH_VERSINFO[0]:-0}" -eq 4 ] && [ "${BASH_VERSINFO[1]:-0}" -ge 4 ]; } ||
    exit 0

# Byte-collation only, so ISO8601 timestamps compare as plain strings regardless
# of the ambient locale's collation rules. LC_CTYPE is deliberately left alone —
# ${#s} must keep counting CHARACTERS for the 80-char excerpt ceiling. Known
# accepted gap: under a non-UTF-8 LC_CTYPE (LC_ALL=C containers), ${s:0:80}
# counts bytes and can split a multi-byte character — cosmetic-only, fails open.
export LC_COLLATE=C

# How much of the transcript tail to scan — bounds runtime to milliseconds on
# a multi-hundred-megabyte transcript. Known accepted gap: if a single turn
# writes more than this window AFTER an enqueue lands, that enqueue scrolls
# out before the next firing and its receipt is silently lost (a later
# enqueue still advances state past it). Fail-open by design — widening the
# window only trades runtime for a rarer miss.
TAIL_BYTES=4000000

INPUT=$(cat)

command -v jq >/dev/null 2>&1 || exit 0

# Load-bearing: the message being submitted RIGHT NOW is itself written to the
# transcript as an enqueue (measured — an ordinary, non-mid-turn message
# enqueues and dequeues ~13ms later), so whenever that write lands before this
# hook runs, the current message would report itself as mid-turn. Matching it by
# content is what excludes it. Known accepted gap, the flush-order mirror image:
# when the current message's enqueue flushes AFTER this hook ran, the NEXT
# firing sees it as new and reports an already-answered ordinary message one
# turn late. No discriminator exists (dequeues carry no content to correlate);
# the banner's own wording bounds the cost — it instructs "confirm instead of
# re-answering" for already-handled messages.
PROMPT=$(jq -r '.prompt // empty' <<<"$INPUT" 2>/dev/null || echo "")

TRANSCRIPT=$(jq -r '.transcript_path // empty' <<<"$INPUT" 2>/dev/null || echo "")
SESSION=$(jq -r '.session_id // empty' <<<"$INPUT" 2>/dev/null || echo "")

[ -n "$TRANSCRIPT" ] || exit 0
[ -f "$TRANSCRIPT" ] && [ -r "$TRANSCRIPT" ] || exit 0
[ -n "$SESSION" ] || exit 0

# The session id reaches a filesystem path, so anything outside the safe set is
# folded to `_` rather than trusted. Real ids are UUIDs; this only matters for
# a malformed envelope.
SAFE_SESSION=$(printf '%s' "$SESSION" | tr -c 'A-Za-z0-9._-' '_')

STATE_DIR="/tmp/claude-$(id -u)"
STATE_FILE="$STATE_DIR/queued-receipt-state-$SAFE_SESSION"

# Mode is set atomically at creation (-m), and a pre-existing directory is
# trusted only if this user owns it: the path is predictable, so on a shared
# /tmp another user could pre-create it (dir squat / symlink plant, CWE-377) —
# chmod on a dir we don't own would fail silently and the write would proceed
# into hostile territory. Fail open instead.
mkdir -p -m 700 "$STATE_DIR" 2>/dev/null || exit 0
[ ! -L "$STATE_DIR" ] || exit 0
[ -O "$STATE_DIR" ] || exit 0
chmod 700 "$STATE_DIR" 2>/dev/null || true

# One record per enqueue as `timestamp<TAB>report|skip<TAB>content`.
#
# `jq -R 'fromjson?'` is required rather than a plain `jq -c` stream: `tail -c`
# cuts on a byte boundary, so the first line of the window is usually half a
# JSON object, and a streaming parser aborts the whole read on it. The `?`
# discards unparseable lines instead.
#
# @tsv escapes tabs, newlines and backslashes inside the content, so one enqueue
# is always exactly one output line no matter what the user typed.
#
# The three non-reportable shapes are CLASSIFIED here rather than filtered out,
# because a skipped entry must still advance the state timestamp: it was seen,
# it is just not worth a receipt. Dropping it instead would pin state below the
# newest enqueue forever and force a full re-evaluation on every message.
#
#   <task-notification>  — Monitor events, not the user typing. They dominate:
#                          57 of 62 enqueues in a measured window.
#   /…                   — a slash command; the harness owns it, nothing to ack.
#   == the current prompt — the message being submitted right now (see $PROMPT).
#
# The prompt exclusion matches by CONTENT, not entry identity, so an earlier,
# genuinely mid-turn message whose text happens to equal the current prompt is
# also excluded — accepted: the assistant still sees and acts on the current
# copy, only the earlier occurrence's mid-turn timing signal is lost.
#
# Both sides of the prompt comparison are trimmed by the SAME jq expression, so
# the two can't drift the way a bash-trim-vs-jq-trim split would.
JQ_FILTER='
  def trim: sub("^[[:space:]]+"; "") | sub("[[:space:]]+$"; "");
  ($prompt | trim) as $now
  | fromjson?
  | select(type == "object")
  | select(.type == "queue-operation" and .operation == "enqueue")
  | select((.timestamp | type) == "string" and (.content | type) == "string")
  | . as $entry
  | ($entry.content | trim) as $body
  | [ $entry.timestamp,
      (if ($body | startswith("<task-notification>")) then "skip"
       elif ($body | startswith("/")) then "skip"
       elif $body == $now then "skip"
       else "report" end),
      $entry.content ]
  | @tsv
'

mapfile -t ENTRIES < <(
    tail -c "$TAIL_BYTES" "$TRANSCRIPT" 2>/dev/null |
        jq -Rr --arg prompt "$PROMPT" "$JQ_FILTER" 2>/dev/null
)

# Every entry advances the max, skipped ones included.
MAX_TS=""
for entry in "${ENTRIES[@]}"; do
    ts=${entry%%$'\t'*}
    [ -n "$ts" ] || continue
    if [ -z "$MAX_TS" ] || [[ "$ts" > "$MAX_TS" ]]; then
        MAX_TS="$ts"
    fi
done

write_state() { # $1 = timestamp to record
    # Never move the high-water mark backward: if a transcript were ever
    # rewritten non-monotonically (no observed trigger — defensive only), a
    # lower scan max must not re-open already-reported entries.
    local current=""
    [ -f "$STATE_FILE" ] && current=$(head -n 1 "$STATE_FILE" 2>/dev/null || echo "")
    if [ -n "$current" ] && [[ "$current" > "$1" ]]; then
        return 0
    fi
    printf '%s\n' "$1" >"$STATE_FILE" 2>/dev/null || return 0
    chmod 600 "$STATE_FILE" 2>/dev/null || true
}

# First run of this session: baseline and say nothing. Epoch when the tail holds
# no enqueue at all, so the next run compares against something rather than
# re-baselining.
if [ ! -f "$STATE_FILE" ]; then
    write_state "${MAX_TS:-1970-01-01T00:00:00.000Z}"
    exit 0
fi

STATE_TS=$(head -n 1 "$STATE_FILE" 2>/dev/null || echo "")
[ -n "$STATE_TS" ] || STATE_TS="1970-01-01T00:00:00.000Z"

# One display line for a message: unescape what @tsv escaped, flatten to a
# single line, and cap at 80 characters.
excerpt() { # $1 = @tsv-escaped content
    local s="$1"
    s=${s//\\n/ }
    s=${s//\\r/ }
    s=${s//\\t/ }
    s=${s//\\\\/\\}
    # Cap BEFORE the collapse loop so a pathological whitespace-heavy paste
    # costs O(cap), not O(message). 400 leaves ample slack to collapse down
    # to the 80-char display ceiling.
    s="${s:0:400}"
    while [[ "$s" == *"  "* ]]; do s=${s//  / }; done
    s="${s#"${s%%[![:space:]]*}"}"
    s="${s%"${s##*[![:space:]]}"}"
    if [ "${#s}" -gt 80 ]; then
        s="${s:0:80}…"
    fi
    printf '%s' "$s"
}

NEW_COUNT=0
EXCERPTS=()
# Known accepted gap: strictly-greater-than means an enqueue whose millisecond
# timestamp EXACTLY equals the recorded high-water mark (written by a prior
# firing) is treated as already-seen and silently never reported. Closing it
# needs a tie-broken identity (timestamp+content) in the state file; a
# same-millisecond straddle across two separate firings is rare enough that
# the fail-open posture (a missed reminder is a missed reminder) covers it.
# >= is not the fix — it would re-report the boundary entry on every firing.
for entry in "${ENTRIES[@]}"; do
    ts=${entry%%$'\t'*}
    [ -n "$ts" ] || continue
    [[ "$ts" > "$STATE_TS" ]] || continue
    rest=${entry#*$'\t'}
    flag=${rest%%$'\t'*}
    [ "$flag" = "report" ] || continue
    content=${rest#*$'\t'}
    NEW_COUNT=$((NEW_COUNT + 1))
    if [ "${#EXCERPTS[@]}" -lt 3 ]; then
        EXCERPTS+=("$(excerpt "$content")")
    fi
done

if [ "$NEW_COUNT" -eq 0 ]; then
    # Advance anyway. Everything newer than the old state was seen and
    # classified as not worth a receipt; leaving state behind would re-evaluate
    # those same entries on every subsequent message, and one permanently
    # skipped entry (a Monitor notification, say) would pin it forever.
    # `:-$STATE_TS` keeps the value unchanged when the tail held no enqueue at
    # all, so an empty scan never rewinds the baseline.
    write_state "${MAX_TS:-$STATE_TS}"
    exit 0
fi

RULE='━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'

printf '%s\n' "$RULE"
printf 'MID-TURN MESSAGES: %s user message(s) arrived while a turn was in flight.\n' "$NEW_COUNT"
printf 'Per 09-interaction-style.md checkpoint (a), give EACH a one-line receipt\n'
printf 'at the top of your reply (restate the ask); if one was already answered\n'
printf 'mid-turn, confirm that instead of re-answering.\n'
for ex in "${EXCERPTS[@]}"; do
    printf '  - %s\n' "$ex"
done
if [ "$NEW_COUNT" -gt 3 ]; then
    printf '  …and %s more\n' "$((NEW_COUNT - 3))"
fi
printf '%s\n' "$RULE"

write_state "${MAX_TS:-$STATE_TS}"
