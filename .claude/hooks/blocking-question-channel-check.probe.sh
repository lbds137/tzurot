#!/bin/bash
# Fixture check for blocking-question-channel-check.sh — run after ANY edit to
# the hook. Asserts the exit-code table over synthetic transcripts: a turn that
# ends on a question fires unless AskUserQuestion or PushNotification was used
# in the same turn. Statements, the stop_hook_active re-stop, and a missing
# transcript all stay silent.
#
# Colocated with the hook — the transcript-parsing python is the fragile part;
# this harness pins its behavior on hook edits.
#
# Usage: .claude/hooks/blocking-question-channel-check.probe.sh   (from repo root)

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/blocking-question-channel-check.sh"
export CLAUDE_PROJECT_DIR=$(cd "$SCRIPT_DIR/../.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

jsonstr() { printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'; }

# Build a transcript: one user turn + an optional tool_use + a final text block.
mktx() { # $1=out $2=text $3=tool_name(optional)
  : > "$1"
  echo '{"type":"user","isMeta":null,"message":{"content":"go"}}' >> "$1"
  [ -n "${3:-}" ] && printf '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"%s","input":{}}]}}\n' "$3" >> "$1"
  printf '{"type":"assistant","message":{"content":[{"type":"text","text":%s}]}}\n' "$(jsonstr "$2")" >> "$1"
}

fail=0
check() { # $1=expected_exit $2=label $3=transcript $4=stop_active
  echo "{\"stop_hook_active\":${4:-false},\"transcript_path\":\"$3\"}" | "$HOOK" >/dev/null 2>&1
  local got=$?
  if [ "$got" != "$1" ]; then echo "FAIL [$got≠$1]: $2"; fail=1; else echo "ok   [$got]: $2"; fi
}

# --- 1. the core fire case ---------------------------------------------------
mktx "$TMP/a.jsonl" "Both approaches work here. Should I use X or Y?"
check 2 "closing question, no formal channel this turn" "$TMP/a.jsonl"

# --- 2/3. the formal channels clear it ---------------------------------------
mktx "$TMP/b.jsonl" "Both approaches work here. Should I use X or Y?" "AskUserQuestion"
check 0 "same question + AskUserQuestion in the turn" "$TMP/b.jsonl"

mktx "$TMP/c.jsonl" "Both approaches work here. Should I use X or Y?" "PushNotification"
check 0 "same question + PushNotification in the turn" "$TMP/c.jsonl"

# An unrelated tool does NOT clear it — only the two formal channels do.
mktx "$TMP/c2.jsonl" "Both approaches work here. Should I use X or Y?" "Bash"
check 2 "an ordinary tool_use is not a formal channel" "$TMP/c2.jsonl"

# --- 4. a statement close ----------------------------------------------------
mktx "$TMP/d.jsonl" "Done — the fix is in and every gate is green."
check 0 "closing statement, no question" "$TMP/d.jsonl"

# --- 5. block-once ------------------------------------------------------------
check 0 "stop_hook_active re-stop always allows" "$TMP/a.jsonl" true

# --- 6. fail-open on a missing/empty transcript ------------------------------
check 0 "missing transcript path (fail-open)" "$TMP/does-not-exist.jsonl"
check 0 "empty transcript path (fail-open)" ""

: > "$TMP/empty.jsonl"
check 0 "empty transcript file (no text block)" "$TMP/empty.jsonl"

# --- 7. trailing markdown must not hide the mark -----------------------------
mktx "$TMP/e.jsonl" "That leaves one call to make. **Ship it as-is, right?**"
check 2 "trailing bold after the question mark still fires" "$TMP/e.jsonl"

TICK=$(printf '\140')
mktx "$TMP/e2.jsonl" "One thing left: do we keep ${TICK}--strict${TICK}?${TICK}"
check 2 "trailing backtick after the question mark still fires" "$TMP/e2.jsonl"

mktx "$TMP/e3.jsonl" "So: which one, A or B?   "
check 2 "trailing whitespace after the question mark still fires" "$TMP/e3.jsonl"

# --- 8. a mid-text question mark is not a closing ask ------------------------
mktx "$TMP/f.jsonl" "The obvious question is: why did it retry?

Because the busy path throws before the usage row is written. Fixed and green."
check 0 "question mid-message, statement close — does not fire" "$TMP/f.jsonl"

mktx "$TMP/f2.jsonl" "Should we cache this? I checked, and the answer is no.
Landed the direct read instead."
check 0 "question in an earlier line, statement close — does not fire" "$TMP/f2.jsonl"

# Trailing blank lines must not mask the question — the LAST NON-EMPTY line decides.
mktx "$TMP/f3.jsonl" "Ready to push. Want me to open the PR?

"
check 2 "trailing blank lines do not mask the closing question" "$TMP/f3.jsonl"

# The final TEXT block is what counts, even when a tool_use follows earlier text.
mktx "$TMP/g.jsonl" "Gates are green. Merge now or wait for the release cut?" "Read"
check 2 "question after an unrelated tool_use in the same turn" "$TMP/g.jsonl"

# A formal channel from a PREVIOUS turn does not clear the current one.
{
  echo '{"type":"user","isMeta":null,"message":{"content":"go"}}'
  echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"AskUserQuestion","input":{}}]}}'
  echo '{"type":"user","isMeta":null,"message":{"content":"option 1"}}'
  printf '{"type":"assistant","message":{"content":[{"type":"text","text":%s}]}}\n' \
    "$(jsonstr "Applied option 1. Should I also bump the baseline?")"
} > "$TMP/h.jsonl"
check 2 "formal channel in an EARLIER turn does not clear this one" "$TMP/h.jsonl"

# --- 9. the lenient no-boundary fallback (the one deliberate deviation from ---
# --- promise-ledger-check: turn_start is None => scan the WHOLE transcript ---
# A boundary-less transcript (no genuine user message) WITH a formal channel:
# the lenient scan credits it — silent. Strict-fail would fire here.
{
  echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"AskUserQuestion","input":{}}]}}'
  printf '{"type":"assistant","message":{"content":[{"type":"text","text":%s}]}}\n' \
    "$(jsonstr "Truncated transcript. Which option did you want?")"
} > "$TMP/i.jsonl"
check 0 "no turn boundary + formal channel anywhere — lenient scan credits it" "$TMP/i.jsonl"

# Same boundary-less shape WITHOUT a formal channel: the fallback still fires.
{
  printf '{"type":"assistant","message":{"content":[{"type":"text","text":%s}]}}\n' \
    "$(jsonstr "Truncated transcript. Which option did you want?")"
} > "$TMP/i2.jsonl"
check 2 "no turn boundary + no formal channel — still fires" "$TMP/i2.jsonl"

[ "$fail" = 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
