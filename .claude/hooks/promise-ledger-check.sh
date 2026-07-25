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
# tool) lands in a different transcript and won't be seen here. There is no
# longer any way for the closing message to assert the write happened: naming
# the file used to satisfy an escape hatch, and that hatch is deliberately gone
# (see below). So a subagent-delegated filing WILL block once, and the only
# recovery is the ordinary one — say where it was filed and stop again, which
# `stop_hook_active` lets through. That is the accepted one-acked-turn cost,
# not a defect.
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

# Strip fenced code blocks and inline spans BEFORE any matching. A pasted type
# declaration is the strongest false trigger there is — `remaining: number;` is a
# line-leading queue word with a colon at distance zero, exactly the label shape
# every position and anchor rule below is tuned to catch. In a TypeScript repo,
# messages carrying an interface are routine and `remaining` / `outstanding` /
# `queued` are ordinary field names.
#
# Lexical, not semantic: this removes markdown code regions by their delimiters,
# the same class of operation as reading a tool name out of the transcript. It
# does not interpret what the code says. A real label survives an inline span
# inside it, because only the span itself is removed.
#
# SHARED, not queue-list-scoped: this rewrites `final_text` for every matcher
# below, PROMISE and ALT included. The motivating case was a pasted type
# declaration, but the consequence reaches further — "I'll `refactor` this
# later" no longer fires, because the verb is inside the stripped span. Accepted
# under the same cost model, and stated here so a future editor does not assume
# the prose matchers see the raw message.
#
# Known uncovered shapes, all judged acceptable against the one-acked-turn cost:
# an UNTERMINATED fence (a truncated paste) is not stripped, but that fails
# toward firing, which is the safe direction; 4-space INDENTED code blocks are
# not stripped at all; and a status heading like "## Remaining Tasks" fires,
# which is arguably correct rather than a false positive — such a heading is a
# list of deferred work.
#
# One known FALSE NEGATIVE, the expensive direction, kept deliberately: a
# trigger word wrapped in its own span ("**Still `queued`**: …") does not fire.
# Note this is NOT merely because the span is removed — a backtick SPLITS the
# phrase, so "still queued" fails to match whether the span survives or not.
# Keeping trigger-bearing spans therefore does not fix it; only deleting the
# backtick characters would, and that turns "`remaining: number` is the field"
# into a line-leading label, trading this rare miss for a likelier misfire.
# Widen this only on an observed misfire, not on speculation: every previous
# attempt to pre-empt a shape here made the matcher worse.
final_text = re.sub(r"```.*?```", "", final_text, flags=re.S)
final_text = re.sub(r"`[^`\n]*`", "", final_text)
if not final_text.strip():
    print("ok"); sys.exit()

# NO filename escape hatch. A previous version passed the turn whenever the
# closing message mentioned any backlog filename, on the theory that naming the
# file meant the promise was tracked there. That inference is topic-correlated,
# not commitment-specific, and it collapses on exactly the days it matters: when
# the backlog IS the work, those filenames appear constantly for unrelated
# reasons, and every promise made that day sails through. Removed deliberately —
# a false positive costs one acknowledged turn (this hook blocks at most once),
# while a false negative costs an untracked commitment. The costs are asymmetric
# by orders of magnitude, so this fails toward firing.

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

# The QUEUE-LIST shape. PROMISE above only matches first-person prose ("I'll fix
# that later") — but deferred work is far more often written as an enumeration
# under a label: "**Still queued**: the two audit findings, the orphan doc, …".
# That form carries no future-tense verb and no deferral marker, so it slipped
# past the prose matcher on every occurrence of a full session.
#
# POSITION is the discriminator, not proximity. A label LEADS A LINE; a prose
# mention sits mid-sentence. An earlier version only required the anchor
# punctuation within ~60 chars of the queue word, which fires on ordinary writing
# in an em-dash-heavy style: "two runs are still queued on GitHub's side — nothing
# for us to do" matched, and so did "the work here is outstanding — nice catch".
# A hook firing on normal sentences at every turn-end trains reflexive
# acknowledgement, which destroys the signal more thoroughly than missing would.
#
# So the queue word must start a line (after an optional list marker and optional
# bold/italic markup), with the anchor following inside a SHORT same-line window.
QUEUE_WORDS = (
    r"still\s+queued|queued(?:\s+up)?|remaining|outstanding|next\s+up|"
    r"left\s+to\s+do|still\s+open|queue[sd]?\s+behind|still\s+to\s+(?:do|come)"
)

# Headings get one extra word — a bare "queue" — under a STRICTER rule than the
# phrases get. The vocabularies are deliberately not identical: "## Queue" is
# unambiguously a deferred-work list, while "the BullMQ queue: jobs run in order"
# is ordinary prose, and in THIS codebase (BullMQ, Redis, job queues) that
# sentence is likely rather than hypothetical. Heading position is strong
# evidence, so it can afford a weaker word; the list matcher cannot.
#
# But heading position alone is not enough for a word this weak: "## Queue
# Configuration" and "## Queue Health" are headings ABOUT the job system, not
# lists of deferred work. So bare "queue" must be the WHOLE heading, while the
# multi-word phrases may appear anywhere in one ("## Remaining Tasks" is a
# deferred-work list no matter what follows the trigger).

# Lead-in punctuation. ASCII hyphen included deliberately: the owner dictates by
# voice, and transcribers render a spoken pause as a plain "-", never an em dash.
# An anchor class omitting it would miss the most likely real form while
# accepting the typographically-correct one nobody types.
#
# Dash-family anchors REQUIRE leading whitespace; colons do not. Without that,
# the window reaches the hyphen inside an ordinary compound word: "Remaining
# work is user-facing polish." matched, because the lazy scan walked 13 chars
# and found the "-" in "user-facing". This codebase's prose is dense with such
# compounds (fail-closed, read-only, cross-user, long-lived), so that is a
# routine sentence, not a contrived one. Colons need no whitespace guard — they
# never occur inside a word.
#
# The WINDOW is what stops a colon reaching across a clause, and 6 is measured
# rather than guessed. Tail length between the trigger word and the anchor:
#   real labels  → 0, 0, 0, 2, 6   ("Remaining:", "**Still queued**:", "Remaining Tasks:")
#   ordinary prose → 8, 9, 9       ("Remaining question:", "Outstanding balance:")
# A window of 6 keeps every label form actually written here and rejects all
# three prose forms. It gives up one uncommon true positive — "Still queued
# behind them:" at 12 — which is the deliberate trade: a false positive at every
# turn-end trains reflexive acknowledgement, and that destroys the signal more
# thoroughly than an occasional miss.
QUEUE_ANCHOR = r"(?:\s[-–—]|[:：])"

# Where a label may begin: line start, OR immediately after a sentence boundary
# on the same line ("All green. Remaining: the sweep."). Sentence-start is
# included because a label routinely follows a closing sentence, and requiring
# line-start alone rejected that real form. It does NOT reintroduce the
# mid-sentence false positives — those have the queue word inside a clause, not
# opening one. Then optional furniture: indent, list bullet or ordinal, bold.
QUEUE_LEAD = (
    r"(?:^|\n|(?<=[.!?])[ \t])[ \t]{0,3}"
    r"(?:[-*+]\s+|\d+[.)]\s+)?(?:\*\*|__|\*)?[ \t]*"
)

QUEUE_LIST = re.compile(
    rf"{QUEUE_LEAD}({QUEUE_WORDS})\b[^\n]{{0,6}}?{QUEUE_ANCHOR}", re.I
)
QUEUE_HEADING = re.compile(
    rf"(?:^|\n)\s{{0,3}}#{{1,6}}\s*(?:"
    rf"[^\n]{{0,40}}?\b({QUEUE_WORDS})\b"  # phrases: anywhere in the heading
    rf"|queue\s*:?\s*(?=\n|$)"             # bare "queue": must BE the heading
    rf")",
    re.I,
)

if (
    PROMISE.search(final_text)
    or ALT.search(final_text)
    or QUEUE_LIST.search(final_text)
    or QUEUE_HEADING.search(final_text)
):
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
Your closing message defers work but no backlog/**/*.md or CURRENT.md
write happened this turn. It matched one of:
  - a prose promise      — "I'll add that later" / "as a follow-up"
  - an enumerated queue  — "**Still queued**: a, b, c" / "## Remaining"
The second form is the one that reads as innocuous: a list under a
label carries no future-tense verb and no deferral marker, which is
exactly why it went unnoticed long enough to lose real commitments.
Per 06-backlog.md § promise ledger, a promise that lives only in chat
dies at the next compaction.

Do ONE of:
  - File it now (cold/follow-ups.md row, or now.md), then stop; or
  - If it's already tracked or is a process action that needs no
    backlog entry, say where/why in one line and stop again (this
    gate fires only once per turn — the next stop proceeds).
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MSG
exit 2
