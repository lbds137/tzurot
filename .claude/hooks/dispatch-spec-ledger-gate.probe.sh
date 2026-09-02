#!/bin/bash
# Fixture check for dispatch-spec-ledger-gate.sh — run after ANY edit to the hook.
#
# Builds a throwaway CLAUDE_PROJECT_DIR holding fake dispatch specs, so the
# probe never reads the real (gitignored) docs/local/dispatch/ tree.
#
# Usage: .claude/hooks/dispatch-spec-ledger-gate.probe.sh   (from anywhere)

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/dispatch-spec-ledger-gate.sh"

TMPDIR_PROBE=$(mktemp -d)
cleanup() { rm -rf "$TMPDIR_PROBE"; }
trap cleanup EXIT

FIXTURE="$TMPDIR_PROBE/fixture"
mkdir -p "$FIXTURE/docs/local/dispatch"

# A spec WITH the required section.
cat >"$FIXTURE/docs/local/dispatch/with-ledger.md" <<'SPEC'
# Dispatch spec — a unit

## Step 0 — base-SHA verification

Required base: `abc1234`.

## Premise ledger (re-verify each before building)

| # | Premise | Established by | Re-verify with |
|---|---------|----------------|----------------|
| L1 | the fix is not already built | grep for its own name | re-run the grep |

## The item
SPEC

# The same spec MINUS the section — the shape the gate exists to catch.
grep -v '^## Premise ledger' "$FIXTURE/docs/local/dispatch/with-ledger.md" \
  >"$FIXTURE/docs/local/dispatch/no-ledger.md"

FAILURES=0

# run <expected-exit> <expect-message-substring|-> <label> <tool_name> <prompt>
run() {
  local expected="$1" needle="$2" label="$3" tool="$4" prompt="$5"
  local out actual
  out=$(
    jq -n --arg t "$tool" --arg p "$prompt" '{tool_name:$t,tool_input:{prompt:$p}}' \
      | CLAUDE_PROJECT_DIR="$FIXTURE" "$HOOK" 2>&1
  )
  actual=$?
  if [ "$actual" -ne "$expected" ]; then
    printf 'FAIL  (exit %d, expected %d)  %s\n' "$actual" "$expected" "$label"
    FAILURES=$((FAILURES + 1))
    return
  fi
  if [ "$needle" != "-" ] && ! grep -qF "$needle" <<<"$out"; then
    printf 'FAIL  (exit %d ok, message missing %q)  %s\n' "$actual" "$needle" "$label"
    FAILURES=$((FAILURES + 1))
    return
  fi
  printf 'PASS  (exit %d)  %s\n' "$actual" "$label"
}

# --- case 1: no spec path in the prompt → not this gate's job ----------------
run 0 - "prompt with no dispatch-spec path passes" "Agent" \
  "Read packages/tooling/src/dev/foo.ts and summarize it."

# --- case 2: spec that HAS the section → passes ------------------------------
run 0 - "spec with a Premise ledger passes (relative path)" "Agent" \
  "Your spec is docs/local/dispatch/with-ledger.md — read it in full."

# --- case 2b: same, named by ABSOLUTE path (the routine dispatch shape) ------
run 0 - "spec with a Premise ledger passes (absolute path)" "Agent" \
  "Your spec is $FIXTURE/docs/local/dispatch/with-ledger.md — read it in full."

# --- case 3: spec MISSING the section → blocks, message names the section ----
run 2 "Premise ledger" "spec without a Premise ledger blocks" "Agent" \
  "Your spec is docs/local/dispatch/no-ledger.md — read it in full."

# --- case 3b: the two mandatory rows are named in the block message ----------
run 2 "FIX'S OWN NAME" "block message names the fix-name row" "Agent" \
  "Your spec is docs/local/dispatch/no-ledger.md — read it in full."
run 2 "PRIOR TASK ID" "block message names the prior-task row" "Agent" \
  "Your spec is docs/local/dispatch/no-ledger.md — read it in full."

# --- case 4: named spec that does not exist → passes -------------------------
# The dispatch will fail on its own first read with a clearer error; a gate
# that blocked here would just be a worse error message.
run 0 - "named-but-absent spec passes" "Agent" \
  "Your spec is docs/local/dispatch/never-written.md — read it in full."

# --- case 5: a non-Agent tool is out of scope --------------------------------
run 0 - "tool_name=Bash passes" "Bash" \
  "Your spec is docs/local/dispatch/no-ledger.md — read it in full."

# --- case 6: heading-level and case tolerance --------------------------------
# `### premise ledger` in a nested spec is the same section; the gate must not
# demand exactly two hashes or exactly one capitalization.
cat >"$FIXTURE/docs/local/dispatch/h3-lower.md" <<'SPEC'
# Spec
### premise ledger
| L1 | a premise | a read | a probe |
SPEC
run 0 - "### and lowercase heading counts as the section" "Agent" \
  "Your spec is docs/local/dispatch/h3-lower.md — read it in full."

# --- case 7: the words in prose are NOT the section --------------------------
# A spec that merely mentions a premise ledger without carrying one must still
# block; otherwise the gate is satisfied by the sentence describing it.
cat >"$FIXTURE/docs/local/dispatch/prose-only.md" <<'SPEC'
# Spec

This unit has no premise ledger because every premise is obvious.
SPEC
run 2 "Premise ledger" "prose mention without the section still blocks" "Agent" \
  "Your spec is docs/local/dispatch/prose-only.md — read it in full."

# --- case 8: spec exists but is UNREADABLE → fails open ----------------------
# grep exits 2 when it cannot read the file. That is an internal error, not a
# missing section, so the gate must pass rather than block a real dispatch.
UNREADABLE="$FIXTURE/docs/local/dispatch/unreadable.md"
cp "$FIXTURE/docs/local/dispatch/no-ledger.md" "$UNREADABLE"
chmod 000 "$UNREADABLE"
if [ "$(id -u)" -eq 0 ] || [ -r "$UNREADABLE" ]; then
  printf 'SKIP  (running as root, or the filesystem ignores mode 000 — an unreadable file cannot be staged)  unreadable spec fails open\n'
else
  run 0 "failing open" "unreadable spec fails open" "Agent" \
    "Your spec is docs/local/dispatch/unreadable.md — read it in full."
fi
# Restore the mode so the trap's cleanup can remove the fixture tree.
chmod 644 "$UNREADABLE"

exit $FAILURES
