#!/bin/bash
# Stop hook: when the agent ends a turn on a question addressed to the user but
# never routed that ask through a formal decision surface (AskUserQuestion or
# PushNotification), block the stop once and remind.
#
# Why it matters: remote control surfaces only formal tool decision points. A
# prose-only question is invisible on the phone, so the session silently stalls
# until the owner happens to open the terminal.
#
# Enforcement geometry mirrors promise-ledger-check.sh: a deterministic scan of
# the ASSISTANT'S OWN output in the current turn, blocking at most once via the
# native `stop_hook_active` flag (deliberately NOT an ack file — the retry
# mechanism is built into the Stop-hook contract). Every external failure — no
# jq, no python3, unreadable or unparseable transcript — exits 0: a missed
# reminder is cheaper than blocking every turn end.
#
# Block-once and the fire/silent table are pinned by
# blocking-question-channel-check.probe.sh.
#
# Known false-negative shapes, accepted under the fail-open cost model (the
# rule in 09-interaction-style.md is the primary mechanism; this is a
# backstop): a question followed by a trailing fenced code block, a closing
# "?" wrapped in quotes/parentheses, and a "?"-less option list ("Pick one:").
# Known false-positive shape, accepted the same way (costs one acknowledged
# turn): a closing inline code span whose content ends in "?" ("Run `foo?`").
#
# 09-interaction-style.md § "Blocking Questions — and Completions the User Must
# See — Go Through a Formal Channel".

set -uo pipefail

INPUT=$(cat)

# Already blocked once this turn-end → allow the stop (no infinite loop).
ACTIVE=$(jq -r '.stop_hook_active // false' <<<"$INPUT" 2>/dev/null || echo "false")
[ "$ACTIVE" = "true" ] && exit 0

TRANSCRIPT=$(jq -r '.transcript_path // empty' <<<"$INPUT" 2>/dev/null || echo "")
[ -z "$TRANSCRIPT" ] || [ ! -f "$TRANSCRIPT" ] && exit 0

VERDICT=$(TRANSCRIPT="$TRANSCRIPT" python3 << 'PYEOF'
import json, os, re, sys

path = os.environ["TRANSCRIPT"]
try:
    lines = open(path, encoding="utf-8").read().splitlines()
except OSError:
    print("ok"); sys.exit()


# A user turn carrying real text, not a tool_result envelope — that bounds the
# current turn (same delimiter promise-ledger-check.sh uses).
def is_genuine_user(entry):
    if entry.get("type") != "user" or entry.get("isMeta"):
        return False
    content = entry.get("message", {}).get("content")
    if isinstance(content, str):
        return len(content.strip()) > 0
    if isinstance(content, list):
        return any(b.get("type") == "text" for b in content)
    return False


records = []
for ln in lines:
    ln = ln.strip()
    if not ln:
        continue
    try:
        records.append(json.loads(ln))
    except json.JSONDecodeError:
        continue

turn_start = None
for i in range(len(records) - 1, -1, -1):
    if is_genuine_user(records[i]):
        turn_start = i
        break

# Boundary not found → scan the WHOLE transcript for the formal channel. That is
# the lenient direction (an older AskUserQuestion can clear the turn), chosen
# deliberately: this hook's cost model is the inverse of the promise ledger's —
# a stale credit costs one missed reminder, while firing on every malformed
# transcript trains reflexive acknowledgement.
turn = records[turn_start:] if turn_start is not None else records

FORMAL_TOOLS = {"AskUserQuestion", "PushNotification"}

used_formal_channel = any(
    block.get("type") == "tool_use" and block.get("name") in FORMAL_TOOLS
    for entry in turn
    if entry.get("type") == "assistant"
    for block in (entry.get("message", {}).get("content", []) or [])
)

if used_formal_channel:
    print("ok"); sys.exit()

# The final assistant text = last text block anywhere (robust to the
# boundary-not-found case; it is always the closing message we read to end).
final_text = ""
for entry in records:
    if entry.get("type") != "assistant":
        continue
    for block in entry.get("message", {}).get("content", []) or []:
        if block.get("type") == "text":
            final_text = block.get("text", "")

# Question shape: the LAST non-empty line ends with a question mark. Position is
# the discriminator — a `?` mid-message is ordinary prose (a rhetorical aside, a
# quoted error, a heading), while a closing line that ends in one is the shape
# that hands the turn back to the user.
lines_out = [ln for ln in final_text.splitlines() if ln.strip()]
if not lines_out:
    print("ok"); sys.exit()

# Trailing markdown emphasis must not hide the mark: "…right?**" and "…right?`"
# are the same ask as "…right?".
last_line = re.sub(r"[*_`\s]+$", "", lines_out[-1])

print("ask" if last_line.endswith("?") else "ok")
PYEOF
) || exit 0

[ "$VERDICT" != "ask" ] && exit 0

cat >&2 << 'MSG'
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BLOCKING QUESTION — asked in prose, never through a formal channel
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Your closing message ends on a question, but this turn used neither
AskUserQuestion nor PushNotification. Remote control surfaces only
formal tool decision points, so a prose-only ask is invisible on the
phone and the session stalls until the owner opens the terminal.

Re-surface the pending ask now, then end the turn normally:
  - AskUserQuestion  — the ask fits structured options (pick one of N)
  - PushNotification — open-ended asks that no option list captures

If the question was rhetorical, already answered, or not actually
blocking, say so in one line and stop again (this gate fires only
once per turn — the next stop proceeds).
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MSG
exit 2
