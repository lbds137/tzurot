#!/bin/bash
# Fixture check for self-matching-pattern-guard.sh — run after ANY edit to the
# hook. Asserts the exit-code table over the shapes that matter: a `pgrep -f`
# / `pkill -f` whose pattern is not the bracket form blocks (exit 2), the
# bracket form and any non-`-f` invocation pass, and a command carrying
# neither `pgrep` nor `pkill` never reaches the scan at all.
# The glued-semicolon class is pinned in both directions: a bare-word pattern
# written `pattern;` (wait loop, if-guard, sequenced command) blocks, and the
# bracket idiom written the same way still passes.
#
# This hook reads no git state — it decides purely from the command text —
# so the harness needs no fixture repo, only the JSON payload shape the
# PreToolUse hook receives on stdin.
#
# Colocated with the hook (not packages/tooling) because it IS the hook's
# verification mechanism — a bash exit-code harness over a bash hook, run
# manually on hook edits, with no ops-CLI surface.
#
# Usage: .claude/hooks/self-matching-pattern-guard.probe.sh   (from repo root)

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/self-matching-pattern-guard.sh"

FAILURES=0

# run <expected-exit> <label> <command>
run() {
  local expected="$1" label="$2" cmd="$3"
  jq -n --arg c "$cmd" '{tool_name:"Bash",tool_input:{command:$c}}' \
    | "$HOOK" >/dev/null 2>&1
  local actual=$?
  if [ "$actual" -eq "$expected" ]; then
    printf 'PASS  (exit %d)  %s\n' "$actual" "$label"
  else
    printf 'FAIL  (exit %d, expected %d)  %s\n' "$actual" "$expected" "$label"
    FAILURES=$((FAILURES + 1))
  fi
}

# --- blocking shapes: an unguarded -f/--full pattern ------------------------
run 2 "pgrep -f simple pattern"               "pgrep -f 'vitest run'"
run 2 "wait loop on pgrep -f"                 'while pgrep -f "railway logs" >/dev/null; do sleep 5; done'
run 2 "pkill -f simple pattern"               'pkill -f node'
run 2 "pgrep --full long-flag pattern"        "pgrep --full 'x'"
run 2 "pgrep -af combined short flags"        'pgrep -af "pnpm test"'
run 2 "pkill -f followed by another flag"     'pkill -f -9 node'
run 2 "absolute-path pgrep -f"                '/usr/bin/pgrep -f node'

# A multi-line command is the routine agent shape, and a line-oriented split
# would see only the first line — leaving every later line unscanned. Both
# directions are pinned: the offender on line 2 still blocks, and the bracket
# form on line 2 still passes (so the newline collapse did not turn the scan
# into a blanket block).
run 2 "pkill -f on the second line of a multi-line command" 'echo start
pkill -f node'

# A `;` glued to the end of the pattern word is the shape a naive separator
# reset drops before inspecting it — and it is the hook's own motivating
# scenario: the wait loop, the if-guard, and the sequenced pkill all write the
# pattern with the separator attached.
run 2 "pattern glued to a trailing semicolon"   'pkill -f node; echo hi'
run 2 "wait loop, bare-word pattern glued to ;" 'while pgrep -f node; do sleep 5; done'
run 2 "if-guard, bare-word pattern glued to ;"  'if pgrep -f node; then echo up; fi'

# The end-of-options separator (`--`) is the only route by which a
# hyphen-leading pattern reaches the matcher rather than being parsed as an
# option by the process-grep tool itself. Both directions are pinned: the
# unquoted hyphen-leading pattern after `--` still blocks, and the bracket
# idiom after `--` still passes.
run 2 "end-of-options then unquoted hyphen-leading pattern" 'pkill -f -- -crond'

# A hyphen-leading pattern quoted (so the shell hands it to pgrep/pkill as a
# single word) without an end-of-options separator was already unreachable
# for the process-grep tool before the set-based rewrite, and stays pinned as
# blocking under it too.
run 2 "quoted hyphen-leading pattern without end-of-options" "pgrep -f '-crond'"

# A value-taking option (one that consumes a following word, e.g. `-u <user>`
# or `--signal <name>`) can sit on either side of the full-cmdline flag in a
# real invocation. The set-based rule handles both positions with the same
# test, unlike a position-tracking scan that only looked for the pattern
# immediately after `-f`.
run 2 "value-taking short option before the flag"  'pgrep -u root -f nginx'
run 2 "value-taking long option before the flag"   'pkill --signal TERM -f node'

# A substitution form ($(...), a backtick capture) is an invocation start
# word too — the tokenizer must not require a bare command word to open one.
run 2 "command substitution capture"        'PID=$(pgrep -f node); echo wait'
run 2 "backtick substitution capture"       'PID=`pgrep -f node`'
run 2 "substitution inside a test"          'if [ -n "$(pgrep -f node)" ]; then echo up; fi'

# A newline is a real statement separator: a bracket word on the NEXT line
# must not rescue an unguarded invocation closed at the end of the line above.
run 2 "bracket word on the NEXT line does not rescue the invocation" 'pkill -f node
echo "[done]"'

# A redirect operator closes the invocation exactly like a separator token:
# the TARGET named after it is not an argument to pgrep/pkill, so a bracket
# leading the target must not rescue an unguarded pattern before it. The
# mirror (the bracket idiom itself written with a redirect) is pinned below
# in the non-blocking section — it must still pass.
run 2 "redirect target opening with a bracket does not rescue the pattern" 'pgrep -f myserver > "[out].log"'
run 2 "stderr redirect target opening with a bracket"                      'pkill -f node 2> "[err].log"'

# --- non-blocking shapes -----------------------------------------------------
run 0 "bracket idiom on the second line of a multi-line command" 'echo start
pgrep -f "[n]ode dist/index.js"'
run 0 "pgrep -f bracket idiom"                "pgrep -f '[v]itest run'"
run 0 "pkill -f bracket idiom"                'pkill -f "[n]ode dist/index.js"'
run 0 "pgrep without -f"                      'pgrep vitest'
run 0 "pkill without -f"                      'pkill node'
run 0 "plain kill by pid"                     'kill 1234'
run 0 "ps | grep, no pgrep/pkill at all"      'ps aux | grep vitest'
run 0 "no pgrep/pkill in the command at all"  'pnpm test'

# The same glued shape in the bracket idiom must still pass — the strip must
# not turn the scan into a blanket block on `;`-terminated commands.
run 0 "bracket idiom glued to a trailing semicolon" 'pgrep -f "[n]ode"; echo ok'
run 0 "bracket idiom in a wait loop glued to ;"     "while pgrep -f '[r]ailway logs'; do sleep 1; done"

run 0 "end-of-options then bracket idiom" "pkill -f -- '[c]rond'"

# The same value-taking-option class as the blocking cases above, pinned on
# the non-blocking side: a value-taking option after the flag doesn't stop
# the bracket word from being seen, and a value-taking option with NO
# full-cmdline flag anywhere in the invocation never blocks at all.
run 0 "value-taking option after the flag, bracket pattern" "pkill -f -u root '[n]ode'"
run 0 "value-taking option, no full-cmdline flag at all"    'pgrep -u root nginx'

# The same substitution/newline shapes as the blocking cases above, pinned on
# the non-blocking side: the bracket idiom inside a substitution still passes,
# a backslash continuation keeps the invocation open across the line break
# rather than splitting it, and an ordinary next line doesn't get scanned as
# part of a safe invocation closed above it.
run 0 "command substitution with the bracket idiom" 'PID=$(pgrep -f "[n]ode")'
run 0 "backslash continuation keeps the invocation open" 'pgrep -f \
"[n]ode"'
run 0 "safe invocation followed by an ordinary next line" 'pkill -f "[n]ode"
echo done'

# ANSI-C quoting puts a `$` before the opening quote; the two-character strip
# must still expose the bracket, or the safe form would block.
run 0 "ANSI-C quoted bracket idiom"  "pgrep -f \$'[n]ode'"

# Mirror of the redirect-target blocking cases above: the bracket idiom
# itself, written with a redirect, must still pass.
run 0 "bracket idiom with a stderr redirect" "pgrep -f '[n]ode' 2>/dev/null"
run 0 "bracket idiom with a stdout redirect" "pkill -f '[n]ode' > out.log"

# --- malformed / edge inputs -------------------------------------------------
# These three carry no pgrep/pkill substring at all, so they exit at the
# raw-payload fast path and never reach the jq decode below. They still pin
# the fast path itself — a payload with neither token must never fall through
# to the scan — but they are NOT evidence about the jq/empty-command branches.
printf '{"tool_name":"Bash","tool_input":{}}' | "$HOOK" >/dev/null 2>&1
if [ $? -eq 0 ]; then
  printf 'PASS  (exit 0)  missing tool_input.command fails open\n'
else
  printf 'FAIL  missing tool_input.command should fail open\n'
  FAILURES=$((FAILURES + 1))
fi

printf 'not json' | "$HOOK" >/dev/null 2>&1
if [ $? -eq 0 ]; then
  printf 'PASS  (exit 0)  malformed tool-input fails open\n'
else
  printf 'FAIL  malformed tool-input should fail open\n'
  FAILURES=$((FAILURES + 1))
fi

printf '' | "$HOOK" >/dev/null 2>&1
if [ $? -eq 0 ]; then
  printf 'PASS  (exit 0)  empty stdin fails open\n'
else
  printf 'FAIL  empty stdin should fail open\n'
  FAILURES=$((FAILURES + 1))
fi

# These two DO carry the substring, specifically so the fast path does NOT
# short-circuit them — they exercise the jq decode and the empty-command
# guard that the three checks above cannot reach.
printf '{"tool_name":"Bash","tool_input":{"note":"pgrep"}}' | "$HOOK" >/dev/null 2>&1
if [ $? -eq 0 ]; then
  printf 'PASS  (exit 0)  tool_input.command absent on a payload that reached jq fails open\n'
else
  printf 'FAIL  tool_input.command absent on a payload that reached jq should fail open\n'
  FAILURES=$((FAILURES + 1))
fi

printf 'pgrep but not json' | "$HOOK" >/dev/null 2>&1
if [ $? -eq 0 ]; then
  printf 'PASS  (exit 0)  jq decode failed on a payload that reached jq fails open\n'
else
  printf 'FAIL  jq decode failure on a payload that reached jq should fail open\n'
  FAILURES=$((FAILURES + 1))
fi

if [ "$FAILURES" -gt 0 ]; then
  printf '\n%d probe(s) FAILED\n' "$FAILURES" >&2
  exit 1
fi
printf '\nAll probes passed\n'
