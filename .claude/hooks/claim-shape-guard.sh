#!/bin/bash
# .husky/pre-commit step: scan the STAGED diff's added lines for claim-shaped
# assertions — "always populated", "never null", "cannot happen",
# "guaranteed to", "only ever".
#
# Those phrasings state what a field or value HOLDS at runtime, which is a
# claim only the producer can settle (.claude/rules/00-critical.md § "The
# producer is authoritative on what a field HOLDS"). A doc comment states the
# author's intent at writing time and drifts silently; near-identical sibling
# interfaces make a plausible-looking declaration weak evidence.
#
# Channel: this runs from `.husky/pre-commit`, NOT as a Claude Code hook.
# Non-blocking PostToolUse output never reaches the agent — probed directly and
# confirmed for every matcher — so the PostToolUse registration this guard used
# to carry enforced nothing. Husky output arrives because it is part of the
# `git commit` command's own stdout.
#
# The channel change buys VISIBILITY, not earlier intervention. An agent runs
# `git commit` as one blocking call, so this banner is read only after the
# commit object already exists — the practical remedy is still an amend, same
# as before. (A human watching an interactive terminal does get the earlier
# moment.) Pre-commit is simply where a staged-diff scan belongs.
#
# Path exclusions: tracker/, backlog/, docs/, .claude/, .husky/, and ALL *.md
# files. Markdown is prose that legitimately DESCRIBES these phrasings
# (CLAUDE.md, CURRENT.md, BACKLOG.md, READMEs — this hook's own source too);
# the guarded surface is claims entering CODE. `.husky/` joins `.claude/` for
# the same reason and was added after this guard flagged the comment in
# `.husky/pre-commit` that describes what it looks for — hook-config surfaces
# necessarily quote the phrasings they guard. Filtering happens on the diff's
# `+++ b/<path>` headers, so a mixed commit still scans its code files.
#
# Advisory only: never blocks, always exits 0, and every git/awk failure
# fails open.
#
# Fixture check: run .claude/hooks/claim-shape-guard.probe.sh after ANY edit.

set -uo pipefail

# CLAUDE_PROJECT_DIR is honored so the probe harness can point this at a
# throwaway repo. Under husky it is normally unset and `cd .` is a no-op —
# git hooks already run from the repo root.
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

# Single `git diff --cached` piped through one awk pass: file-header tracking
# for the path exclusions, then the claim-shape match over added lines only.
# The -c overrides force canonical a/ b/ unquoted headers regardless of the
# user's diff.mnemonicPrefix / core.quotePath config, which the path
# exclusions depend on.
# The 3-line cap lives INSIDE awk rather than in a `head -3`: under
# `pipefail`, head closing the pipe early makes the whole substitution exit
# nonzero, and a fail-open `|| MATCHES=""` there would silently discard the
# very matches it just found. The cap is COMMIT-wide, not per-file — the
# banner is a pointer to the staged change, not an exhaustive report.
MATCHES=$(git -c diff.mnemonicprefix=false -c core.quotepath=false diff --cached 2>/dev/null | awk '
/^\+\+\+ /{
    path = substr($0, 5)
    sub(/^b\//, "", path)
    skip = (path ~ /^(tracker|backlog|docs|\.claude|\.husky)\// || path ~ /\.md$/) ? 1 : 0
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

printf 'CLAIM-SHAPE GUARD: staged line(s) assert what a field/value always or never holds:\n'
printf '%s\n' "$MATCHES" | sed 's/^/  /'
printf 'Per 00-critical § the producer is authoritative: verify each at its producer/assignment site and cite it, or amend.\n'

exit 0
