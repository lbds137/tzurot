#!/bin/bash
# Stop hook: when a turn ends with a TOOL CALL as its last content block,
# block the stop once and ask for the closing text.
#
# Why it matters: a unit-completing turn owes the owner two utterances — the
# report leads, a short confirmation closes. A turn that ends on the tool
# result itself delivers neither; the owner sees a silent stop and reads it as
# a stall (10-working-posture.md § Report shape). A PushNotification is the
# same failure in costume: it feels like delivery, but it is not the report.
#
# Enforcement geometry mirrors the two sibling Stop hooks: a deterministic scan
# of the ASSISTANT'S OWN output, blocking at most once via the native
# `stop_hook_active` flag (not an ack file — the retry mechanism is built into
# the Stop-hook contract). If the turn genuinely ended correctly and the last
# block is a tool call for some other reason, one line of text and a second
# stop proceeds.
#
# Transcript shape this reads (verified against the real corpus, not assumed):
# each assistant entry's `.message.content` is an ARRAY, and in the current
# harness it holds exactly ONE block — the harness splits one API response into
# one JSONL entry per block, which is what the entry's `apiBlockIndex` field
# indexes. Block types observed: `thinking`, `text`, `tool_use`. Reading "the
# last block of the last assistant entry" is therefore correct under BOTH the
# split shape and a multi-block shape, which is why it is written that way
# rather than as "the last entry's only block".
#
# Every external failure — no jq, no transcript, an entry with no content
# array — exits 0: a missed reminder is cheaper than blocking every turn end.
#
# Pinned by turn-end-shape-gate.probe.sh.

set -uo pipefail

INPUT=$(cat)

# Already blocked once this turn-end → allow the stop (no infinite loop).
ACTIVE=$(jq -r '.stop_hook_active // false' <<<"$INPUT" 2>/dev/null || echo "false")
[ "$ACTIVE" = "true" ] && exit 0

TRANSCRIPT=$(jq -r '.transcript_path // empty' <<<"$INPUT" 2>/dev/null || echo "")
[ -z "$TRANSCRIPT" ] || [ ! -f "$TRANSCRIPT" ] && exit 0

# Bounded tail rather than the whole file: the transcript runs to hundreds of
# megabytes on a long session, and the entry this hook wants is at its very
# end. `tail -n` counts newlines from the end, so every line it yields is
# complete — no partial-first-line JSON to strip.
#
# The 2000 is a bound, not a guarantee: if the last assistant entry sits older
# than the window, the tail yields none and the hook exits 0 — failing open,
# which is this hook's posture everywhere else too.
read_last_content() {
  tail -n 2000 "$TRANSCRIPT" 2>/dev/null \
    | jq -c 'select(.type == "assistant") | select(.isSidechain != true) | .message.content' 2>/dev/null \
    | tail -n 1
}

# The read is retried rather than taken once. Observed premise: the harness can
# flush the turn's final TEXT entry after this hook has already started, so one
# immediate read can see the turn's last tool call as the last assistant entry
# and block a turn that did end on text. Observed on two of three text-ending
# turn ends (naming Bash once and SendMessage once as the supposed last block);
# in one, the text entry's timestamp preceded the hook's own feedback entry by
# ~180 ms. The flush window itself was not measured, so the five reads are a
# hedge, not a derived bound.
#
# Residual, stated plainly: a flush slower than the whole poll window still
# produces a false block. The `stop_hook_active` guard above bounds that to a
# single retry, after which the stop proceeds.
#
# Only the BLOCK path pays for the waiting: a turn that already reads as
# text-ended returns on the first read.
LAST_CONTENT=""
for attempt in 1 2 3 4 5; do
  [ "$attempt" -gt 1 ] && sleep 0.3
  LAST_CONTENT=$(read_last_content)

  # No assistant entry in the tail, or no content array → nothing to judge.
  [ -z "$LAST_CONTENT" ] && exit 0

  LAST_TYPE=$(jq -r 'if type == "array" and length > 0 then (.[-1].type // "") else "" end' <<<"$LAST_CONTENT" 2>/dev/null || echo "")
  [ "$LAST_TYPE" = "tool_use" ] || exit 0
done

TOOL=$(jq -r 'if type == "array" and length > 0 then (.[-1].name // "a tool") else "a tool" end' <<<"$LAST_CONTENT" 2>/dev/null || echo "a tool")

cat >&2 <<EOF
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TURN END SHAPE — this turn ends on a tool call ($TOOL)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A unit-completing turn ends on TEXT. The report leads and a short
confirmation closes; ending on the tool result delivers neither, and
the owner reads the silence as a stall.

Deliver it now:
  - the user-facing report, if it has not been said yet, or
  - the one-line confirmation that the bookkeeping writes landed.

A PushNotification is not the report — it is the same failure in a
costume that feels like delivery. Say it in the turn.

If this turn was not unit-completing (mid-work, or the tool call is
genuinely the last thing the owner needs), say so in one line and stop
again — this gate fires once per turn end.
(10-working-posture.md § Report shape)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
exit 2
