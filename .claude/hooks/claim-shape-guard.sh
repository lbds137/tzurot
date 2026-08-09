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
# `cannot be` is NARROWED to a following value token (null/empty/set/…) rather
# than matching bare. Unqualified, it fired on ordinary design prose about code
# STRUCTURE — "cannot be collapsed into one", "cannot be extracted", "cannot be
# reused" — which asserts nothing about runtime and has no producer to cite.
# That noise is not free: a guard whose output is mostly false positives trains
# the reader to skim past the true ones. The other arms (`always populated`,
# `never null`, `cannot happen`) are already runtime-claim-shaped and are left
# alone.
#
# The trailing ([^a-z]|$) is LOAD-BEARING, not tidiness. awk's `~` is a
# substring match with no \b, so an unanchored alternation matched whenever the
# next word merely STARTS with a token: "cannot be settled" hit `set`, "cannot
# be negatively impacted" hit `negative`, "cannot be zeroed out" hit `zero`.
# That is the same design-prose false positive the narrowing exists to remove,
# reintroduced through the back door.
#
# `[^a-z]` is a broad boundary, not a true word break — awk ERE has no \b — so
# ANY hyphenated compound built on a token still fires: "cannot be
# false-positive", "cannot be zero-indexed", "cannot be null-terminated". The
# limitation is not specific to one token, and a reader who assumes otherwise
# will be surprised by the second one. Left as is: the constructions are rare,
# and over-firing on an advisory guard costs a glance where under-firing costs
# the signal entirely.
#
# `reached` was considered for the token list and left OUT: "this branch cannot
# be reached" is a control-flow claim, not a claim about what a value holds, so
# it sits outside this guard's stated scope and reads like the design prose
# above. If reachability claims ever deserve a guard, that is its own decision
# with its own evidence. Pinned silent in the probe so the decision cannot be
# reverted by accident.
#
# ACCEPTED RECALL LOSS: only the exact token form fires, so inflected ones no
# longer do — "cannot be nulled / emptied / populating" are real value claims
# that now pass unflagged, where the bare arm caught them. This is a deliberate
# trade of recall for precision, not an oversight, and it is not free.
#
# Not fixed by adding the inflections, because the ambiguity is genuine rather
# than a vocabulary gap: "the count cannot be zeroed out" is pinned SILENT here
# as design prose, yet it is defensible as a value claim. Deciding that sentence
# either way requires the reader's context, which is exactly the judgement the
# bare arm made badly and noisily. A guard that fires on the unambiguous forms
# and stays quiet on the arguable ones is the version people keep reading.
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
    if (tolower(line) ~ /always (populated|set|non-null|present|returns)|never (null|empty|undefined|happens|fires)|cannot be (null|empty|undefined|unset|set|present|absent|missing|zero|negative|false|true|populated)([^a-z]|$)|cannot (happen|match|occur)|guaranteed to|(is|are) always|only ever/) {
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
