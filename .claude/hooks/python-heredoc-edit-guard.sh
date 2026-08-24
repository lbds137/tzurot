#!/bin/bash
# PreToolUse hook (matcher: Bash) — blocks an inline interpreter script (a
# `python3 -c`/heredoc invocation, or `node -e`/`--eval`) that ALSO writes a
# file, in favor of the Edit tool or a dispatched worker
# (10-working-posture.md § Delegation posture).
#
# A fresh rewrite-script pays its whole body as output tokens on every edit
# and bypasses edit tracking, unlike the Edit tool's diff-only cost. Plain
# shell redirects (`echo > file`) are explicitly NOT this hook's business —
# only an interpreter invocation whose own body writes a file blocks.
#
# Two independent regex checks must BOTH match for a block:
#   1. an interpreter-script invocation shape (python -c/-, a heredoc into
#      python, or node -e/--eval)
#   2. a file-write call shape inside the command text (open(...,'w'/'a'),
#      write_text/write_bytes, writeFileSync/appendFileSync)
#
# Uses `grep -P` (PCRE) rather than spawning python — the regexes here are
# self-contained and don't need the shared shell_quotes lib lossy-pipe-guard.sh
# uses for command-substitution-aware parsing. Fail-open on any internal
# error (grep -P unavailable, empty input, etc.) — a broken gate must not
# block real work.
#
# Bypass for deliberate bulk generation:
#
#   TZUROT_ALLOW_HEREDOC_EDIT=1 <command>
#
# Fixture check: run .claude/hooks/python-heredoc-edit-guard.probe.sh after
# ANY edit to this hook.

set -uo pipefail

INPUT=$(cat)

TOOL_NAME=$(jq -r '.tool_name // empty' <<<"$INPUT" 2>/dev/null || echo "")
[ "$TOOL_NAME" != "Bash" ] && exit 0

GUARD_CMD=$(jq -r '.tool_input.command // empty' <<<"$INPUT" 2>/dev/null || echo "")
[ -z "$GUARD_CMD" ] && exit 0

# Anchored to an assignment position (start of string, or after whitespace,
# `;`, `&`, `|`) and followed by whitespace — a quote- or punctuation-adjacent
# mention of the literal cannot bypass. A prose mention with whitespace on both
# sides still can; flat-string matching cannot close that, only narrow it.
BYPASS_RE='(^|[[:space:];&|])TZUROT_ALLOW_HEREDOC_EDIT=1[[:space:]]'
if [[ "$GUARD_CMD" =~ $BYPASS_RE ]]; then
  exit 0
fi

# `grep -P` failing for a reason OTHER than "no match" (e.g. PCRE support
# missing) must not be mistaken for "no match" — capture the exit status
# rather than relying on `&&`/`||` short-circuiting alone.
INTERP_RE='python3?\s+(-c\b|-\s|-$)|python3?\s*-?\s*<<|node\s+(-e|--eval)\b'
WRITE_RE="open\([^)]*,\s*['\"][wa]|\.open\(\s*['\"][wa]|mode\s*=\s*['\"][wa]|write_text\(|write_bytes\(|writeFileSync\(|appendFileSync\("

grep -Pq "$INTERP_RE" <<<"$GUARD_CMD" 2>/dev/null
INTERP_RC=$?
grep -Pq "$WRITE_RE" <<<"$GUARD_CMD" 2>/dev/null
WRITE_RC=$?

# grep exit codes: 0 = match, 1 = no match, 2 = error (bad pattern, no PCRE
# support). Only a clean double-match (both 0) blocks; anything else,
# including a grep error on either side, falls through to allow.
if [ "$INTERP_RC" -ne 0 ] || [ "$WRITE_RC" -ne 0 ]; then
  exit 0
fi

cat >&2 <<'EOF'
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PYTHON-HEREDOC EDIT GUARD — inline interpreter script writes a file
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A fresh rewrite-script pays its whole body as output tokens every
time (measured ~7x the Edit tool per edit) and bypasses edit
tracking. Use the Edit tool, or dispatch the unit to a worker.

Deliberate bulk generation: prefix the command with
TZUROT_ALLOW_HEREDOC_EDIT=1 to pass this gate.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
exit 2
