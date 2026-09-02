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
# Size measurement: the inline exemption in the rule is "≤5-line mechanical
# edit", and this gate MEASURES that five from the tool input itself — for an
# Edit, max(lines(old_string), lines(new_string)); for a Write, lines(content);
# for a MultiEdit, the sum of those maxima over `edits[]`. Over five touched
# lines is a HARD block: no ack is recorded and retrying does not pass, because
# the exemption the ack path exists to serve does not apply. Five or fewer
# falls through to the ack path below, unchanged. The five is the OUTER gate,
# not one exemption among siblings: the rule's other inline clause ("the spec
# would cost more than the edit") lives INSIDE the cap, so above five touched
# lines dispatch is the only path whichever justification applied.
#
# The metric is LINE COUNT, not characters, so a single very long line passes
# under it. Accepted: a character metric would misclassify ordinary edits, and
# the class this gate targets is the multi-line inline fix.
#
# A Write is sized on the WHOLE `content` on purpose: Write creates a new file
# (an edit to an existing >5-line source file goes through Edit), so a Write of
# an existing file's full body is always hard-blocked — which is the intended
# outcome, not a miscount.
#
# This measures edit SIZE only
# — review-ROUND caps stay advisory by the owner's standing ruling, and nothing
# here touches them.
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

# How many lines this single call touches. The empty/absent string counts 0 (a
# pure insertion has no old text, a pure deletion no new text); otherwise the
# count is `\n` count + 1, ignoring ONE trailing newline — a five-line block
# ending in a newline is five lines, not six, and counting it as six would
# hard-block an edit the exemption covers. Fail-open: an unparseable input
# yields 0 and falls through to the ack path. Pinned by the trailing-newline
# fixtures in dispatch-posture-gate.probe.sh.
TOUCHED=$(jq -r '
  def nlines: (. // "") | if . == "" then 0 else (1 + (sub("\n$"; "") | [match("\n"; "g")] | length)) end;
  if .tool_name == "Edit" then
    [(.tool_input.old_string | nlines), (.tool_input.new_string | nlines)] | max
  elif .tool_name == "Write" then
    .tool_input.content | nlines
  elif .tool_name == "MultiEdit" then
    ([.tool_input.edits[]? | ([(.old_string | nlines), (.new_string | nlines)] | max)] | add) // 0
  else 0 end
' <<<"$INPUT" 2>/dev/null || echo 0)
case "$TOUCHED" in
  '' | *[!0-9]*) TOUCHED=0 ;;
esac

if [ "$TOUCHED" -gt 5 ]; then
  cat >&2 <<EOF
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DISPATCH POSTURE — inline src edit of $TOUCHED lines (limit 5)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The inline exemption is a ≤5-line mechanical edit in a file already in
context (10-working-posture.md § Delegation posture). This call touches
$TOUCHED lines, so the exemption does not apply — and comment-only bulk
is not an exception, it is the same context re-bill.

Retrying will NOT pass: no ack is recorded for an over-size edit.

Do one of:
  - dispatch the unit per /tzurot-orchestration (nested dispatch), or
    hand a review round's batch to the unit's worker; or
  - split this into edits that each stand alone at five lines or fewer.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
  exit 2
fi

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

If this edit is inline-exempt (a mechanical edit within the measured
5-line limit, or work where the spec would cost more than the edit):
retry — this gate passes once acked at this commit. Over five touched
lines there is no ack and no retry; that block is hard.

Otherwise: dispatch the unit per /tzurot-orchestration (nested
dispatch), or hand the review round's batch to the unit's worker.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
exit 2
