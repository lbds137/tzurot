#!/bin/bash
# PreToolUse hook (matcher: Edit|Write|MultiEdit) — nudges the main loop
# toward dispatching implementation instead of editing main-loop `services/`
# or `packages/` source inline (10-working-posture.md § Delegation posture).
# Every main-loop tool call re-bills the full context, so an inline edit to
# a src file is the shape most worth catching once per commit-anchored
# editing burst (see Ack semantics below).
#
# Scope: only Edit/Write/MultiEdit targeting a resolved path under
# `${CLAUDE_PROJECT_DIR}/(services|packages)/**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts,py}`.
# Docs, config, tests-via-non-matching-extension, and anything under a
# nested `.claude/worktrees/` (a worker's own scratch tree) are exempt.
#
# Ack semantics: the FIRST blocked edit at a given (UTC date, branch, HEAD)
# records an ack key and blocks (exit 2); retrying the SAME call finds the
# key already recorded and passes (exit 0). HEAD is part of the key so the
# reminder RE-ARMS after every commit: a review-round fix is by construction
# a post-commit edit, and a per-day ack lets the initial build's ack silently
# cover every later review round on the branch. The point
# is still stop-and-decide-once — once per commit-anchored editing burst,
# not once forever.
#
# Accepted tradeoff: the ack is branch-wide, not caller-scoped — any same-tree
# process (main loop or a contract-violating same-tree worker) shares one ack
# per (date, branch, HEAD). File-mutating workers are worktree-isolated by contract
# (/tzurot-orchestration § Worktree spawns), so in-contract workers never reach
# this gate; a violation consuming the ack is a minor fail-open loss.
#
# Fail-open on any internal error (missing jq, unwritable ack file, etc.) —
# a broken nudge must never block real work.

set -uo pipefail

INPUT=$(cat)

TOOL_NAME=$(jq -r '.tool_name // empty' <<<"$INPUT" 2>/dev/null || echo "")
case "$TOOL_NAME" in
  Edit | Write | MultiEdit) ;;
  *) exit 0 ;;
esac

FILE_PATH=$(jq -r '.tool_input.file_path // empty' <<<"$INPUT" 2>/dev/null || echo "")
[ -z "$FILE_PATH" ] && exit 0

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

case "$FILE_PATH" in
  /*) RESOLVED="$FILE_PATH" ;;
  *) RESOLVED="$PROJECT_DIR/$FILE_PATH" ;;
esac

# Must resolve under the project root at all.
case "$RESOLVED" in
  "$PROJECT_DIR"/*) ;;
  *) exit 0 ;;
esac

REL="${RESOLVED#"$PROJECT_DIR"/}"

# Only main-loop source under services/ or packages/ is in scope.
if [[ ! "$REL" =~ ^(services|packages)/.+\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|py)$ ]]; then
  exit 0
fi

# A worker's own worktree scratch tree is exempt — the gate targets the
# main loop editing inline, not a dispatched worker doing its job.
case "$RESOLVED" in
  */.claude/worktrees/*) exit 0 ;;
esac

ACK_FILE="${DISPATCH_POSTURE_ACK_FILE:-/tmp/.claude_dispatch_posture_ack.$(id -u)}"
BRANCH=$(git -C "$PROJECT_DIR" branch --show-current 2>/dev/null || echo detached)
HEAD_SHA=$(git -C "$PROJECT_DIR" rev-parse --short HEAD 2>/dev/null || echo nohead)
ACK_KEY="$(date -u +%F):$PROJECT_DIR:$BRANCH:$HEAD_SHA"

if [ -f "$ACK_FILE" ] && grep -qxF "$ACK_KEY" "$ACK_FILE" 2>/dev/null; then
  exit 0
fi

if ! printf '%s\n' "$ACK_KEY" >>"$ACK_FILE" 2>/dev/null; then
  echo "dispatch-posture-gate: could not write ack file $ACK_FILE — failing open" >&2
  exit 0
fi
chmod 600 "$ACK_FILE" 2>/dev/null || true

cat >&2 <<'EOF'
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DISPATCH POSTURE — first main-loop src edit since the last commit
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The main loop dispatches implementation; it does not do it inline
(10-working-posture.md § Delegation posture). Every main-loop tool
call re-bills the full context (~50k weighted tokens). A post-commit
edit is usually a REVIEW-ROUND fix — those are dispatch work
(/tzurot-review-response § 3a), and inline rounds measured self-fed.

If this edit is inline-exempt (≤~5-line mechanical edit, or the spec
would cost more than the edit): retry — this gate passes once acked
at this commit.

Otherwise: dispatch the unit per /tzurot-orchestration (nested
dispatch), or hand the review round's batch to the unit's worker.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
exit 2
