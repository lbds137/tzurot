#!/bin/bash
# SessionStart hook: make session grounding structural instead of
# instruction-dependent. stdout from this hook is injected into context.
#
# - startup / resume / clear: inject CURRENT.md (the always-loaded status
#   surface, line-budgeted by `pnpm ops lines:check`) plus the board pointer,
#   so the CLAUDE.md "Session Start" read order happens even when attention
#   doesn't.
# - compact: inject the post-compaction recovery checklist (the failure class
#   where re-suggested settings, dropped promises, and lost work-stack
#   pointers keep recurring — see CLAUDE.md Compaction Instructions).

set -uo pipefail

INPUT=$(cat)
SOURCE=$(jq -r '.source // empty' <<<"$INPUT" 2>/dev/null || echo "")
ROOT="${CLAUDE_PROJECT_DIR:-.}"

if [ "$SOURCE" = "compact" ]; then
  # INDEPENDENT COPY WARNING: this checklist is a curated action-subset of
  # CLAUDE.md's "Compaction Instructions" section (which stays auto-loaded
  # with the full preservation list). It is NOT sourced from that file —
  # when Compaction Instructions change, re-sync this block by hand.
  cat <<'EOF'
POST-COMPACTION RECOVERY (structural checklist — act before new work):
0. Undelivered reports FIRST: if the compaction summary names a user-facing
   report, answer, or completion message that was never delivered, deliver it
   in the FIRST reply — before any tool calls. (Mined twice: the user asked
   "what do you need from me?" because a finished unit's report died at the
   boundary.)
1. Session settings: recover effort level / permission mode from pre-compaction
   state; do NOT re-suggest settings that were already active. The env block's
   MODEL line may be stale after an in-session /model switch — verify the
   driver model via the session JSONL's per-message `.message.model` field
   before asserting it, and never flag a mismatch from the env block alone.
2. Open promises and asks: grep the session JSONL under
   ~/.claude/projects/<project-slug>/ for "I'll" and unanswered user questions
   before re-deriving or guessing at lost state.
3. Work-stack pointer: resume the interrupted task at its resume point; a
   side-quest does not clear the main line.
4. Re-read .claude/rules/ and CURRENT.md. Auto-loaded content never counts as
   Read for editing — Edit/Write requires a fresh Read of any file first.
EOF
  exit 0
fi

echo "=== CURRENT.md (auto-injected by session-start hook) ==="
cat "$ROOT/CURRENT.md" 2>/dev/null || echo "(CURRENT.md not found)"
echo "=== End CURRENT.md — next: read backlog/now.md (+ active-epic.md) before pulling work ==="

exit 0
