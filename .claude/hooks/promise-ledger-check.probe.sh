#!/bin/bash
# Fixture check for promise-ledger-check.sh — run after ANY edit to the hook.
# Asserts the exit-code table over synthetic transcripts: a deferred-work
# promise with no same-turn backlog write (and no backlog-file mention) blocks;
# a same-turn write, a backlog-file mention, a process-action promise, and a
# no-promise close all pass. The stop_hook_active re-stop always passes.
#
# Colocated with the hook — the transcript-parsing python is the fragile part;
# this harness pins its behavior on hook edits.
#
# Usage: .claude/hooks/promise-ledger-check.probe.sh   (from repo root)

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/promise-ledger-check.sh"
export CLAUDE_PROJECT_DIR=$(cd "$SCRIPT_DIR/../.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Build a transcript: one user turn + optional Edit(file) + a final text block.
mktx() { # $1=out $2=text $3=edited_file(optional)
  : > "$1"
  echo '{"type":"user","isMeta":null,"message":{"content":"go"}}' >> "$1"
  [ -n "${3:-}" ] && printf '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"%s"}}]}}\n' "$3" >> "$1"
  printf '{"type":"assistant","message":{"content":[{"type":"text","text":%s}]}}\n' "$(printf '%s' "$2" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" >> "$1"
}

fail=0
check() { # $1=expected_exit $2=label $3=transcript $4=stop_active
  echo "{\"stop_hook_active\":${4:-false},\"transcript_path\":\"$3\"}" | "$HOOK" >/dev/null 2>&1
  local got=$?
  if [ "$got" != "$1" ]; then echo "FAIL [$got≠$1]: $2"; fail=1; else echo "ok   [$got]: $2"; fi
}

mktx "$TMP/a.jsonl" "Filed the export nit. I'll add the sync gate later once the schema settles."
check 2 "promise + unrelated 'Filed' word, no write" "$TMP/a.jsonl"

mktx "$TMP/b.jsonl" "I'll add the sync gate later once the schema settles." "$CLAUDE_PROJECT_DIR/backlog/cold/follow-ups.md"
check 0 "promise + same-turn backlog write" "$TMP/b.jsonl"

mktx "$TMP/c.jsonl" "All merged. I'll merge #1732 once CI passes."
check 0 "process-action promise (merge once CI)" "$TMP/c.jsonl"

mktx "$TMP/d.jsonl" "Done — the fix is in and tests are green. Anything else?"
check 0 "no promise" "$TMP/d.jsonl"

mktx "$TMP/e.jsonl" "Good idea — let's not forget the ratchet trend work."
check 2 "let's-not-forget, no write" "$TMP/e.jsonl"

mktx "$TMP/f.jsonl" "I'll circle back to the browse retrofit after this PR. Tracked in follow-ups.md already."
check 0 "promise but names a backlog file" "$TMP/f.jsonl"

mktx "$TMP/h.jsonl" "I will add the sync gate later once the schema settles."
check 2 "full-form 'I will' promise (not just the contraction), no write" "$TMP/h.jsonl"

check 0 "stop_hook_active re-stop always allows" "$TMP/a.jsonl" true

# Finding 2: a transcript with NO genuine user turn must fail strict — an
# unfiled promise still fires (no earlier backlog write gets credited).
{
  echo '{"type":"user","isMeta":true,"message":{"content":[{"type":"tool_result","content":"x"}]}}'
  echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"'"$CLAUDE_PROJECT_DIR"'/backlog/cold/follow-ups.md"}}]}}'
  printf '{"type":"assistant","message":{"content":[{"type":"text","text":%s}]}}\n' \
    "$(printf '%s' "I'll add the sync gate later." | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
} > "$TMP/g.jsonl"
check 2 "no genuine user turn → strict: earlier backlog write NOT credited" "$TMP/g.jsonl"

[ "$fail" = 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
