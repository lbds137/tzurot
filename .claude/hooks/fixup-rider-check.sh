#!/bin/bash
# PostToolUse hook: after a `git commit --fixup` lands, surface the rider
# checklist from /tzurot-review-response rule 3.
#
# Review-response riders systematically get less scrutiny than planned work —
# "one clause" / "~10 lines" is exactly the size that skips the checks a
# planned change gets. The three questions below are the authoring-time
# complement to rule 3's test gate: the test gate catches breakage, this
# catches absence.
#
# Advisory only: never blocks, always exits 0. Fires on every matching commit
# (the banner is short) — no dedup state file, because a rider committed twice
# deserves the checklist twice. Known limitation (accepted, same class as
# claim-shape-guard's): detection is command-text only, so a commit whose
# MESSAGE merely mentions `--fixup` also fires — spurious banner, no harm.
#
# Fixture check: run .claude/hooks/fixup-rider-check.probe.sh after ANY edit.

set -uo pipefail

INPUT=$(cat)

# Cheapest possible short-circuit, on the RAW stdin, before jq is even
# forked: firing requires a `git commit`, so a payload carrying no git+commit
# tokens anywhere cannot decode to one — the overwhelming majority of Bash
# calls (and every non-Bash tool call) leave without spawning a process.
case "$INPUT" in
*git*commit*) ;;
*) exit 0 ;;
esac

TOOL_NAME=$(jq -r '.tool_name // empty' <<<"$INPUT" 2>/dev/null || echo "")
[ "$TOOL_NAME" != "Bash" ] && exit 0

COMMAND=$(jq -r '.tool_input.command // empty' <<<"$INPUT" 2>/dev/null || echo "")
[ -z "$COMMAND" ] && exit 0

# Cheap bash-native short-circuit: a commit carrying no fixup token at all
# exits here (sibling hooks set the same do-cheap-checks-first precedent).
case "$COMMAND" in
*--fixup*) ;;
*) exit 0 ;;
esac

# Both `git commit` and the fixup flag in either form (`--fixup=<sha>` /
# `--fixup <sha>`) must be present.
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/git-command.sh
. "$SCRIPT_DIR/lib/git-command.sh" 2>/dev/null || exit 0
is_git_commit_command "$COMMAND" || exit 0
if ! grep -qE '(^|[[:space:]])--fixup([=[:space:]]|$)' <<<"$COMMAND"; then
    exit 0
fi

cat <<'EOF'
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FIXUP RIDER CHECK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Per /tzurot-review-response rule 3 — a rider that ADDS or MOVES code
answers the same three questions a planned change answers:
  (a) Does the addition need its own test? ("it's small" is not an exemption)
  (b) Does it stale a comment or doc elsewhere — including files this fix
      did not touch (schema.prisma doc comments, rules, skills)?
  (c) Does moving code between files change what a coverage or mutation
      gate measures?
If any answer is yes and unhandled, amend before pushing.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
