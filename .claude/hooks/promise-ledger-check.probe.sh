#!/bin/bash
# Fixture check for promise-ledger-check.sh — run after ANY edit to the hook.
# Asserts the exit-code table over synthetic transcripts. A deferred-work
# promise blocks unless a same-turn backlog write happened — and a bare mention
# of a backlog FILENAME no longer clears it (fixture `f`), because naming a file
# is topic correlation rather than evidence this commitment is tracked. Passing
# cases: a same-turn write, a process-action promise, a no-promise close, and
# the stop_hook_active re-stop.
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

# SPEC CHANGE (deliberate, not a weakened assertion): the filename escape hatch
# is gone. Naming a backlog file no longer clears the turn — it is topic
# correlation, not proof this commitment is tracked, and it passed every promise
# made on a day whose work WAS the backlog. Expectation flips 0 → 2.
mktx "$TMP/f.jsonl" "I'll circle back to the browse retrofit after this PR. Tracked in follow-ups.md already."
check 2 "naming a backlog file no longer clears a promise (hatch removed)" "$TMP/f.jsonl"

# The queue-list shape — verbatim forms that slipped past the prose matcher.
# Each was a real untracked commitment: an enumeration under a label carries no
# future-tense verb and no deferral marker, so PROMISE cannot see it.
mktx "$TMP/q1.jsonl" "Done and merged.

**Still queued**: the two \`commands:audit\` findings, the orphan doc, and the monitor caveat."
check 2 "queue-list: bolded 'Still queued:' lead-in" "$TMP/q1.jsonl"

mktx "$TMP/q2.jsonl" "That's landed.

## Queue

- the commands:audit pair
- the 05-tooling caveat"
check 2 "queue-list: markdown heading" "$TMP/q2.jsonl"

mktx "$TMP/q3.jsonl" "All green. Remaining: the singleton sweep and the parity guard."
check 2 "queue-list: 'Remaining:' lead-in" "$TMP/q3.jsonl"

# False-positive guards — the queue words in ordinary prose, no label anchor.
mktx "$TMP/q4.jsonl" "The remaining budget is about 50k tokens, so we have room."
check 0 "FP guard: 'remaining' in prose, no colon anchor" "$TMP/q4.jsonl"

mktx "$TMP/q5.jsonl" "Two runs are still queued on GitHub's side; nothing for us to do."
check 0 "FP guard: 'still queued' describing CI, no label anchor" "$TMP/q5.jsonl"

# A queue-list WITH a same-turn backlog write still passes — filing is the fix.
mktx "$TMP/q6.jsonl" "**Still queued**: the audit pair and the caveat." "$CLAUDE_PROJECT_DIR/backlog/now.md"
check 0 "queue-list + same-turn backlog write" "$TMP/q6.jsonl"

# Anchor coverage. The plain ASCII hyphen is the one that matters most: voice
# transcription renders a spoken pause as "-", never as an em dash, so an anchor
# class without it misses the likeliest real form.
mktx "$TMP/q7.jsonl" "All green. Remaining - the singleton sweep and the parity guard."
check 2 "queue-list: plain ASCII hyphen lead-in (voice-dictated form)" "$TMP/q7.jsonl"

mktx "$TMP/q8.jsonl" "All green. Remaining – the singleton sweep."
check 2 "queue-list: en-dash lead-in" "$TMP/q8.jsonl"

# Heading vocabulary parity — these matched NEITHER pattern when the list and
# heading matchers kept separate word lists.
mktx "$TMP/q9.jsonl" "Merged.

## Still Open

- the parity guard"
check 2 "queue-heading: 'Still Open' (list-only vocabulary before the merge)" "$TMP/q9.jsonl"

mktx "$TMP/q10.jsonl" "Merged.

### Left To Do

- the singleton sweep"
check 2 "queue-heading: 'Left To Do' (list-only vocabulary before the merge)" "$TMP/q10.jsonl"

# A bare "queue" is heading-only. In a BullMQ/Redis codebase these are ordinary
# sentences, and a shared-vocabulary union would fire on both.
mktx "$TMP/q11.jsonl" "Traced it: the BullMQ queue: jobs are processed in order, so ordering is fine."
check 0 "FP guard: bare 'queue' + colon in prose (BullMQ discussion)" "$TMP/q11.jsonl"

mktx "$TMP/q12.jsonl" "Redis queue - the worker drains it every 30s, so the backlog clears itself."
check 0 "FP guard: bare 'queue' + hyphen in prose (Redis discussion)" "$TMP/q12.jsonl"

mktx "$TMP/q13.jsonl" "Done.

## Queue

- the audit pair"
check 2 "queue-heading: bare 'queue' IS allowed in heading position" "$TMP/q13.jsonl"

# ── Vocabulary coverage: every QUEUE_WORDS alternative, positive AND negative.
# Half the vocabulary previously had zero fixtures, so "all fixtures pass" said
# nothing about most of the words it claimed to verify.
mktx "$TMP/v1.jsonl"  "Outstanding: the parity guard and the sweep."
check 2 "vocab+: 'outstanding' as a line-leading label" "$TMP/v1.jsonl"
mktx "$TMP/v2.jsonl"  "Next up - the commands:audit pair."
check 2 "vocab+: 'next up' as a line-leading label" "$TMP/v2.jsonl"
mktx "$TMP/v3.jsonl"  "Queued up: the drain batches."
check 2 "vocab+: 'queued up' as a line-leading label" "$TMP/v3.jsonl"
mktx "$TMP/v4.jsonl"  "Queues behind it — the singleton sweep."
check 2 "vocab+: 'queues behind' as a line-leading label" "$TMP/v4.jsonl"
mktx "$TMP/v5.jsonl"  "Still to do: the receipt ritual."
check 2 "vocab+: 'still to do' as a line-leading label" "$TMP/v5.jsonl"
mktx "$TMP/v6.jsonl"  "Still to come — the question-receipt hook."
check 2 "vocab+: 'still to come' as a line-leading label" "$TMP/v6.jsonl"

# ── FP guards in an EM-DASH-HEAVY prose style. The earlier guards used a
# semicolon, a form the owner does not write, so they passed while the same
# sentences with an em dash fired. Mid-sentence position must not match.
mktx "$TMP/v7.jsonl"  "Two runs are still queued on GitHub's side — nothing for us to do."
check 0 "FP guard: 'still queued' mid-sentence + em dash" "$TMP/v7.jsonl"
mktx "$TMP/v8.jsonl"  "The work here is outstanding — nice catch on the anchor class."
check 0 "FP guard: 'outstanding' mid-sentence + em dash" "$TMP/v8.jsonl"
mktx "$TMP/v9.jsonl"  "This PR is still open for review — nothing blocking."
check 0 "FP guard: 'still open' mid-sentence + em dash" "$TMP/v9.jsonl"
mktx "$TMP/v10.jsonl" "The remaining budget is about 50k — plenty of room."
check 0 "FP guard: 'remaining' mid-sentence + em dash" "$TMP/v10.jsonl"
mktx "$TMP/v11.jsonl" "That's outstanding work on the parity guard - thanks."
check 0 "FP guard: 'outstanding' mid-sentence + ASCII hyphen" "$TMP/v11.jsonl"

# Code regions are stripped before matching. A pasted type declaration is the
# strongest false trigger available: a line-leading queue word with a colon at
# distance zero is precisely the label shape the rules above are tuned for, and
# in a TypeScript repo those field names are ordinary.
TICK=$(printf '\140')
FENCE="$TICK$TICK$TICK"

mktx "$TMP/c1.jsonl" "Here is the shape:

${FENCE}ts
interface RateLimitState {
  remaining: number;
  outstanding: string[];
}
${FENCE}

Nothing deferred."
check 0 "FP guard: 'remaining:' / 'outstanding:' inside a fenced TS block" "$TMP/c1.jsonl"

mktx "$TMP/c2.jsonl" "Done.

**Still queued**: the ${TICK}commands:audit${TICK} pair and the caveat."
check 2 "real label still fires when it contains an inline code span" "$TMP/c2.jsonl"

mktx "$TMP/c3.jsonl" "Quoting the old wording: ${TICK}Remaining: the sweep${TICK} and nothing more."
check 0 "FP guard: a label QUOTED inside an inline span does not fire" "$TMP/c3.jsonl"

# ACCEPTED false negative, pinned so it is a decision rather than a surprise: a
# trigger word wrapped in its own span does not fire. The backtick SPLITS the
# phrase, so keeping trigger-bearing spans would not fix it either — only
# deleting backtick characters would, and that makes "`remaining: number` is the
# field" a line-leading label. Rare miss traded for a likelier misfire.
mktx "$TMP/c4.jsonl" "Done.

**Still ${TICK}queued${TICK}**: the sweep and the guard."
check 0 "ACCEPTED FN: trigger word split by its own inline span" "$TMP/c4.jsonl"

# Bare "queue" is heading-only AND must be the whole heading. A heading ABOUT
# the job system is not a list of deferred work; the multi-word phrases keep
# the looser rule because "## Remaining Tasks" is a deferred-work list whatever
# follows the trigger.
mktx "$TMP/h1.jsonl" "Traced it.

## Queue Configuration

The prefetch is set to 4."
check 0 "FP guard: '## Queue Configuration' is a job-system heading" "$TMP/h1.jsonl"

mktx "$TMP/h2.jsonl" "Traced it.

## Queue Health

Depth is nominal."
check 0 "FP guard: '## Queue Health' is a job-system heading" "$TMP/h2.jsonl"

mktx "$TMP/h3.jsonl" "Merged.

## Remaining Tasks

- the singleton sweep"
check 2 "phrase headings keep the looser rule ('## Remaining Tasks')" "$TMP/h3.jsonl"

# Hyphenated compound words must not supply the anchor. The <=30-char window
# otherwise reaches the "-" inside an ordinary compound, and this codebase's
# prose is dense with them (user-facing, fail-closed, read-only, cross-user).
# Dash anchors therefore require leading whitespace; colons do not.
mktx "$TMP/w1.jsonl" "Remaining work is user-facing polish."
check 0 "FP guard: compound word supplies no anchor ('user-facing')" "$TMP/w1.jsonl"
mktx "$TMP/w2.jsonl" "Outstanding items are fail-closed by design."
check 0 "FP guard: compound word supplies no anchor ('fail-closed')" "$TMP/w2.jsonl"
mktx "$TMP/w3.jsonl" "Next up we need cross-user checks before the sweep."
check 0 "FP guard: compound word supplies no anchor ('cross-user')" "$TMP/w3.jsonl"
mktx "$TMP/w4.jsonl" "Remaining - the singleton sweep and the parity guard."
check 2 "spaced hyphen IS still a valid anchor" "$TMP/w4.jsonl"

# The anchor WINDOW stops a colon reaching across a clause. Real labels have a
# tail of 0-6 chars between trigger and colon; ordinary prose runs 8-9. Window
# of 6 is measured, not guessed.
mktx "$TMP/x1.jsonl" "Remaining question: should we ship now or wait?"
check 0 "FP guard: colon across a clause ('Remaining question:')" "$TMP/x1.jsonl"
mktx "$TMP/x2.jsonl" "Outstanding balance: 50 dollars due."
check 0 "FP guard: colon across a clause ('Outstanding balance:')" "$TMP/x2.jsonl"
mktx "$TMP/x3.jsonl" "Next up question: do we ship today?"
check 0 "FP guard: colon across a clause ('Next up question:')" "$TMP/x3.jsonl"
mktx "$TMP/x4.jsonl" "Remaining Tasks: the singleton sweep."
check 2 "label with a short tail still fires ('Remaining Tasks:')" "$TMP/x4.jsonl"

# Subagent-delegated filing: the write lands in a DIFFERENT transcript, so this
# hook cannot see it and blocks once. Naming the file no longer clears it (the
# hatch is gone), so the only recovery is the ordinary stop-and-re-ack. Pinned
# because the hook comment now makes that claim explicitly.
mktx "$TMP/s1.jsonl" "Filed via a subagent. Tracked in backlog/cold/follow-ups.md now.

**Still queued**: the audit pair."
check 2 "subagent-delegated write blocks once (no cross-transcript visibility)" "$TMP/s1.jsonl"
check 0 "…and the re-stop clears it" "$TMP/s1.jsonl" true

# Code stripping is SHARED with PROMISE/ALT, not queue-list-scoped. Pinned so the
# consequence is a recorded decision rather than a surprise to a future editor.
mktx "$TMP/s2.jsonl" "I'll ${TICK}refactor${TICK} this later once the schema settles."
check 0 "ACCEPTED: prose promise whose VERB sits in a stripped span" "$TMP/s2.jsonl"
mktx "$TMP/s3.jsonl" "I'll refactor the ${TICK}QueueService${TICK} later once the schema settles."
check 2 "prose promise still fires when only an incidental span is stripped" "$TMP/s3.jsonl"

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
