#!/bin/bash
# Stop hook: when the agent tries to end a turn whose final message makes a
# deferred-work promise ("I'll file that later", "follow-up after this PR")
# WITHOUT a same-turn write to a backlog file or CURRENT.md, block the stop
# once and remind — the promise ledger dies in chat otherwise, and the owner
# ends up asking "what's the plan for those?" a session later.
#
# Enforcement geometry mirrors the origin-vocabulary merge gate: a deterministic
# scan of the ASSISTANT'S OWN output, blocking once until acknowledged. The
# `stop_hook_active` flag makes it fire at most once per turn-end — if the
# promise is already tracked, or is a process action that needs no backlog
# entry, the agent notes that and stops again (the second stop is allowed).
#
# Trigger is deliberately narrow (deferred-WORK verbs + a deferral marker) to
# keep false positives low; the same-turn backlog-write gate suppresses the
# common "promised AND filed in the same breath" case.
#
# 06-backlog.md § "The promise ledger — file at the moment of utterance".

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

# Walk from the end to the last GENUINE user message (a user turn carrying real
# text, not a tool_result envelope) — that bounds the current turn.
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

# If the turn boundary can't be found, fail toward STRICT: an empty turn means
# wrote_backlog stays False, so an unfiled promise still fires (rather than
# crediting a backlog write from some earlier point in the session and silently
# defeating the same-turn check). The final message is scanned regardless.
turn = records[turn_start:] if turn_start is not None else []

BACKLOG_RE = re.compile(r"(^|/)(backlog/|CURRENT\.md|BACKLOG\.md)")

# (a) same-turn backlog writes. LIMITATION: only direct Edit/Write/MultiEdit in
# THIS transcript count — a backlog file written by a delegated subagent (Agent
# tool) lands in a different transcript and won't be seen here; the closing
# message must then name the backlog file to take the escape hatch below.
wrote_backlog = any(
    block.get("type") == "tool_use"
    and block.get("name") in ("Edit", "Write", "MultiEdit")
    and BACKLOG_RE.search(str(block.get("input", {}).get("file_path", "")))
    for entry in turn
    if entry.get("type") == "assistant"
    for block in (entry.get("message", {}).get("content", []) or [])
)

# (b) the final assistant text = last text block ANYWHERE (robust to the
# boundary-not-found case; it's always the closing message we read to end).
final_text = ""
for entry in records:
    if entry.get("type") != "assistant":
        continue
    for block in entry.get("message", {}).get("content", []) or []:
        if block.get("type") == "text":
            final_text = block.get("text", "")

if wrote_backlog or not final_text.strip():
    print("ok"); sys.exit()

# Escape hatch: the message names an actual backlog FILE where it's tracked.
# Deliberately filename-based, not a bare "filed/tracked" word — the word form
# false-negatived "Filed the export nit. I'll add the gate later" (the "filed"
# was about a different thing; the promise was still unfiled). False positives
# here cost one acknowledged turn; false negatives defeat the hook — bias to fire.
TEXT_TRACK_RE = re.compile(
    r"(backlog/|follow-ups\.md|ideas\.md|now\.md|active-epic\.md|epic-log\.md|queue\.md|CURRENT\.md|BACKLOG\.md)",
    re.I,
)
if TEXT_TRACK_RE.search(final_text):
    print("ok"); sys.exit()

# Deferred-WORK promise: a work verb + a deferral marker, reasonably close.
# Narrow on purpose — "I'll merge once CI passes" (process, not backlogged
# work) lacks a work verb here and is correctly ignored.
PROMISE = re.compile(
    r"\b(?:I['’]?ll|I\s+will)\s+(?:\w+\s+){0,3}?"
    r"(add|fix|file|handle|implement|build|write|create|update|migrate|refactor|clean\s*up|revisit|circle\s+back)"
    r"\b.{0,60}?\b(later|after\s+(this|the)|once\b|next\s+session|tomorrow|down\s+the\s+line|follow[-\s]?up)",
    re.I | re.S,
)
ALT = re.compile(
    r"\b(let['’]?s\s+not\s+forget|as\s+a\s+follow[-\s]?up|in\s+a\s+follow[-\s]?up\s+PR)\b",
    re.I,
)
if PROMISE.search(final_text) or ALT.search(final_text):
    print("promise")
else:
    print("ok")
PYEOF
) || exit 0

[ "$VERDICT" != "promise" ] && exit 0

cat >&2 << 'MSG'
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROMISE LEDGER — deferred-work promise without a same-turn backlog write
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Your closing message defers work ("I'll … later" / "follow-up …") but
no backlog/**/*.md or CURRENT.md write happened this turn. Per
06-backlog.md § promise ledger, a promise that lives only in chat
dies at the next compaction.

Do ONE of:
  - File it now (cold/follow-ups.md row, or now.md), then stop; or
  - If it's already tracked or is a process action that needs no
    backlog entry, say where/why in one line and stop again (this
    gate fires only once per turn — the next stop proceeds).
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MSG
exit 2
