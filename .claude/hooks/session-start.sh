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

# Overdue periodic passes: fail-open but VISIBLE. Any failure (no pnpm on PATH,
# a broken ledger, the timeout) prints the unavailable line instead of silence;
# an empty result means nothing is overdue. DOTENV_CONFIG_QUIET pins dotenv
# quiet: the installed version printed no load banner when probed, but its
# logger writes to stdout whenever quiet is off, and any stdout line would make
# the result never empty.
CADENCE=$(cd "$ROOT" && DOTENV_CONFIG_QUIET=true timeout 15 pnpm -s ops cadence:status --overdue-only 2>/dev/null) \
  || CADENCE="(cadence status unavailable — run: pnpm ops cadence:status)"
if [ -n "$CADENCE" ]; then
  echo "=== Overdue periodic passes (backlog/cadence-ledger.json) ==="
  printf '%s\n' "$CADENCE"
fi

# Orphan reconciliation — PRINT ONLY: never kills, never removes. Two kinds of
# survivor outlive the session that created them: agent worktrees (nothing reaps
# them) and CI-gate waiters. The pgrep pattern is written in the bracket form so
# the listing cannot match the shell evaluating it (self-matching-pattern-guard.sh).
# `--remotes` reads local tracking refs and this hook does no network I/O, so
# unpushed can read high until `git fetch -p`; that errs toward not removing.
SELF=$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null)
ORPHANS=""
while read -r _ WT; do
  case "$WT" in *"/.claude/worktrees/"*) ;; *) continue ;; esac
  [ "$WT" = "$SELF" ] && continue
  ORPHANS+="  $WT [$(git -C "$WT" rev-parse --abbrev-ref HEAD 2>/dev/null)]"
  ORPHANS+=" dirty=$(git -C "$WT" status --porcelain 2>/dev/null | wc -l)"
  ORPHANS+=" unpushed=$(git -C "$WT" log --oneline HEAD --not --remotes 2>/dev/null | wc -l)"$'\n'
done < <(git -C "$ROOT" worktree list --porcelain 2>/dev/null | grep '^worktree ')
WAITERS=$(pgrep -af '[g]h:ci-gate' 2>/dev/null)
if [ -n "$ORPHANS" ] || [ -n "$WAITERS" ]; then
  echo "=== Orphans from earlier sessions (print-only — reconcile deliberately) ==="
  [ -n "$ORPHANS" ] && printf '%s' "$ORPHANS"
  [ -n "$WAITERS" ] && printf '%s\n' "$WAITERS" | sed 's/^/  waiter pid /'
  echo "  Worktree: dirty=0 and unpushed=0 → git worktree remove <path>; otherwise reconcile first."
  echo "  Waiter: kill the exact PID above — never a pattern kill (00-critical.md)."
fi

exit 0
