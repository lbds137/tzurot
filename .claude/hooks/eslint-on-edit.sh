#!/bin/bash
# PostToolUse hook (matcher: Edit|Write|MultiEdit): lint a touched TypeScript file so
# feedback lands in-session instead of waiting for lint-staged or CI.
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
pnpm exec eslint --no-warn-ignored -- "$FILE" 2>&1 | head -50

exit 0
