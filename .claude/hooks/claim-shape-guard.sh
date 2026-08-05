#!/bin/bash
# PostToolUse hook: after a `git commit` lands, scan the new commit's ADDED
# lines for claim-shaped assertions — "always populated", "never null",
# "cannot happen", "guaranteed to", "only ever".
#
# Those phrasings state what a field or value HOLDS at runtime, which is a
# claim only the producer can settle (.claude/rules/00-critical.md § "The
# producer is authoritative on what a field HOLDS"). A doc comment states the
# author's intent at writing time and drifts silently; near-identical sibling
# interfaces make a plausible-looking declaration weak evidence. This hook
# fires at the moment the claim enters history, when amending is still cheap.
#
# Path exclusions: tracker/, backlog/, docs/, .claude/, and ALL *.md files.
# Markdown is prose that legitimately DESCRIBES these phrasings (CLAUDE.md,
# CURRENT.md, BACKLOG.md, READMEs — this hook's own source too); the guarded
# surface is claims entering CODE. Filtering happens on the diff's
# `+++ b/<path>` headers, so a mixed commit still scans its code files.
#
# Advisory only: never blocks, always exits 0, and every git/grep failure
# fails open.
#
# Fixture check: run .claude/hooks/claim-shape-guard.probe.sh after ANY edit.

set -uo pipefail

INPUT=$(cat)

# Cheapest possible short-circuit, on the RAW stdin, before jq is even
# forked: a payload carrying no git+commit tokens anywhere cannot decode to
# a command that carries them, so the overwhelming majority of Bash calls
# (and every non-Bash tool call) leave without spawning a process.
case "$INPUT" in
*git*commit*) ;;
*) exit 0 ;;
esac

TOOL_NAME=$(jq -r '.tool_name // empty' <<<"$INPUT" 2>/dev/null || echo "")
[ "$TOOL_NAME" != "Bash" ] && exit 0

COMMAND=$(jq -r '.tool_input.command // empty' <<<"$INPUT" 2>/dev/null || echo "")
[ -z "$COMMAND" ] && exit 0

# Same short-circuit against the DECODED command — the raw-stdin pass above
# can be satisfied by tokens living in some other JSON field.
case "$COMMAND" in
*git*commit*) ;;
*) exit 0 ;;
esac

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/git-command.sh
. "$SCRIPT_DIR/lib/git-command.sh" 2>/dev/null || exit 0
is_git_commit_command "$COMMAND" || exit 0

# Known limitations (accepted, matching develop-code-commit-guard.sh): the
# scan targets CLAUDE_PROJECT_DIR's HEAD, so a commit aimed elsewhere —
# `git -C <other-checkout>` or a cd into a worktree — scans the wrong commit.
# Accepted because worker agents never commit (opus-implementer contract: the
# orchestrator commits from the main checkout) and the hook is advisory. The
# command-text match also can't tell whether a commit LANDED: a failed commit
# (hook rejection, nothing-to-commit) or a command that merely mentions
# `git commit` (heredoc, echo) re-scans the current HEAD and may repeat an
# already-seen banner. Accepted for the same advisory-only reason.
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

# Single `git show` piped through one awk pass: file-header tracking for the
# path exclusions, then the claim-shape match over added lines only.
# `--format=` suppresses the commit header so only diff lines reach awk; the
# -c overrides force canonical a/ b/ unquoted headers regardless of the
# user's diff.mnemonicPrefix / core.quotePath config, which the path
# exclusions depend on.
# The 3-line cap lives INSIDE awk rather than in a `head -3`: under
# `pipefail`, head closing the pipe early makes the whole substitution exit
# nonzero, and a fail-open `|| MATCHES=""` there would silently discard the
# very matches it just found. The cap is COMMIT-wide, not per-file — the
# banner is a pointer to the commit, not an exhaustive report; the amend
# pass reads the full diff anyway.
MATCHES=$(git -c diff.mnemonicprefix=false -c core.quotepath=false show --format= HEAD 2>/dev/null | awk '
/^\+\+\+ /{
    path = substr($0, 5)
    sub(/^b\//, "", path)
    skip = (path ~ /^(tracker|backlog|docs|\.claude)\// || path ~ /\.md$/) ? 1 : 0
    next
}
/^\+/{
    if (skip || n >= 3) next
    line = substr($0, 2)
    if (tolower(line) ~ /always (populated|set|non-null|present|returns)|never (null|empty|undefined|happens|fires)|cannot (be|happen|match|occur)|guaranteed to|(is|are) always|only ever/) {
        print substr(line, 1, 100)
        n++
    }
}
')

# Any git/awk failure leaves this empty, which is the fail-open path.
[ -z "${MATCHES//[[:space:]]/}" ] && exit 0

printf 'CLAIM-SHAPE GUARD: added line(s) assert what a field/value always or never holds:\n'
printf '%s\n' "$MATCHES" | sed 's/^/  /'
printf 'Per 00-critical § the producer is authoritative: verify each at its producer/assignment site and cite it; amend if unverified.\n'
