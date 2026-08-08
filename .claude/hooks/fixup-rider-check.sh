#!/bin/bash
# .husky/commit-msg step: when the commit being written is a fixup/squash
# rider, surface the rider checklist from /tzurot-review-response rule 3.
#
# Usage: .claude/hooks/fixup-rider-check.sh <commit-msg-file>
#
# Review-response riders systematically get less scrutiny than planned work —
# "one clause" / "~10 lines" is exactly the size that skips the checks a
# planned change gets. The three questions below are the authoring-time
# complement to rule 3's test gate: the test gate catches breakage, this
# catches absence.
#
# Channel: this runs from `.husky/commit-msg`, NOT as a Claude Code hook.
# Non-blocking PostToolUse output never reaches the agent — probed directly and
# confirmed for every matcher — so the PostToolUse registration this check used
# to carry printed into a void. Husky output arrives because it is part of the
# `git commit` command's own stdout.
#
# Reading the MESSAGE rather than the command text also kills the false
# positive the PostToolUse version documented and accepted: a commit whose
# message merely MENTIONS `--fixup` used to fire. Git writes a literal
# `fixup! ` / `squash! ` subject prefix for real riders and nothing else does,
# so the subject is an exact signal where the command text was a heuristic.
#
# Advisory only: never blocks, always exits 0. No dedup state — a rider
# committed twice deserves the checklist twice.
#
# Fixture check: run .claude/hooks/fixup-rider-check.probe.sh after ANY edit.

set -uo pipefail

MSG_FILE="${1:-}"
[ -z "$MSG_FILE" ] && exit 0
[ -f "$MSG_FILE" ] || exit 0

# The subject is the first line that is neither blank nor a git comment.
# `git commit --fixup` writes the generated subject on line 1, but reading
# past leading blanks/comments keeps this correct for editor-authored messages.
#
# `#` is hardcoded as the comment character. git's `core.commentChar` can be
# set to something else, in which case a real `#` line would be skipped as a
# comment (or a comment in the configured character read as the subject). Not
# worth reading git config for: this repo has never set it, and both failure
# directions cost at most a missing or spurious advisory banner — the hook
# never blocks. Named here because every other edge case in this file is.
SUBJECT=$(grep -m1 -vE '^[[:space:]]*(#|$)' "$MSG_FILE" 2>/dev/null || echo "")
[ -z "$SUBJECT" ] && exit 0

# All three prefixes reach this hook end-to-end: commitlint runs first in
# .husky/commit-msg and would exit 1 on an unrecognised type, but it ignores
# every rider prefix. Verified live against this repo's own config rather than
# assumed from commitlint's defaults — `fixup!`, `squash!` and `amend!`
# subjects each pass `commitlint --edit`, so none of these arms is dead.
case "$SUBJECT" in
fixup!* | squash!* | amend!*) ;;
*) exit 0 ;;
esac

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

exit 0
