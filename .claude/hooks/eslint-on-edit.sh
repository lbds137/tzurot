#!/bin/bash
# UNREGISTERED — retained for reference, not wired into .claude/settings.json.
#
# This lints a touched TypeScript file so feedback lands in-session instead of
# waiting for lint-staged or CI. It never delivered on that: non-blocking
# PostToolUse output does not reach the agent (probed directly — a deliberate
# lint error in an edited file produced correct hook output when the payload was
# fed in by hand, and nothing arrived in context), so its ~4.8s per edited .ts
# file bought nothing. The enforcing gates were always lint-staged and CI, both
# of which still run. Registering it again requires evidence that the delivery
# channel changed — see TASK-458.
#
# The measured cost and the ruled-out `--cache` fix are tracked in TASK-287,
# which is moot while this stays unregistered.
#
# Matchers can only match TOOL NAMES — file filtering must happen here, from
# the stdin JSON payload. (The previous inline hook used a file-pattern
# matcher plus a $CLAUDE_FILE_PATH env var; neither exists in the hook
# contract, so it never fired.)
#
# Non-blocking by design: always exits 0. Output (if any) surfaces as
# advisory feedback; the enforcing gates remain lint-staged and CI.

set -uo pipefail

INPUT=$(cat)
FILE=$(jq -r '.tool_input.file_path // empty' <<<"$INPUT" 2>/dev/null || echo "")

[ -z "$FILE" ] && exit 0
case "$FILE" in
  *.ts | *.tsx) ;;
  *) exit 0 ;;
esac
[ -f "$FILE" ] || exit 0

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# --no-warn-ignored: test files are excluded via eslint.config.js ignores;
# without the flag every touched test file emits a pointless ignore warning.
#
# Deliberately NO --cache: this hook only ever lints the file that was JUST
# edited, so its cache entry is always stale and the lookup can never hit.
# Measured 4.8s either way on a touched target; --cache is worth ~2.5x only on
# an UNCHANGED target, which this invocation shape never produces. The ~4.8s is
# node startup plus building the type-aware TS program, which no flag avoids.
pnpm exec eslint --no-warn-ignored -- "$FILE" 2>&1 | head -50

exit 0
